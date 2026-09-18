import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { generateOrderNumber } from "../utils/generateOrderNumber.js";
import { validateCouponForUser } from "../utils/couponValidation.js";
import { sendEmail, orderConfirmationEmail, orderStatusEmail } from "../utils/sendEmail.js";
import { notify } from "../utils/notify.js";
import { reserveStock, releaseStock } from "../utils/stockOps.js";

// payment_pending and payment_verification are both "in-progress" states
// that a customer can still cancel.  Once an order reaches placed/confirmed
// it follows the normal admin-controlled lifecycle.
const CANCELLABLE_STATUSES = ["payment_pending", "payment_verification", "placed", "confirmed", "processing"];
const FLAT_SHIPPING_FEE = 50;
const FREE_SHIPPING_THRESHOLD = 999;

function resolveStock(product, variantId) {
  if (variantId) {
    const variant = product.variants.id(variantId);
    return variant ? variant.stock : 0;
  }
  return product.stock;
}

// @desc    Checkout — create a payment-pending order from the current cart.
//          The only supported payment method for new orders is "upi_manual".
//          The order stays in "payment_pending" until the customer submits
//          payment proof via POST /api/orders/:id/payment-proof.
//          Stock is reserved atomically at this point so inventory doesn't
//          oversell while the customer completes payment.
//          The cart is NOT cleared here — it is cleared only after admin
//          verifies the payment so the customer keeps their cart if they
//          abandon the payment flow.
// @route   POST /api/orders
// @access  Private
export const createOrder = asyncHandler(async (req, res) => {
  const { addressId, shippingAddress: rawAddress, couponCode } = req.body;

  // Only upi_manual for new orders.  Historical razorpay/cod records remain
  // readable but no new Razorpay payments are created.
  const paymentMethod = "upi_manual";

  // ── Resolve shipping address ────────────────────────────────────────────
  let shippingAddress = rawAddress;
  if (addressId) {
    const savedAddress = req.user.addresses.id(addressId);
    if (!savedAddress) {
      return res.status(400).json({ success: false, message: "Address not found." });
    }
    shippingAddress = savedAddress.toObject();
  }
  if (!shippingAddress?.fullName || !shippingAddress?.line1) {
    return res.status(400).json({ success: false, message: "A valid shipping address is required." });
  }

  // ── Load & validate cart ────────────────────────────────────────────────
  const cart = await Cart.findOne({ user: req.user._id }).populate("items.product");
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ success: false, message: "Your cart is empty." });
  }

  // ── Snapshot line items & compute subtotal ──────────────────────────────
  const orderItems = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const product = item.product;
    if (!product || !product.isAvailable) {
      return res.status(400).json({
        success: false,
        message: `${product?.name || "A product"} is no longer available.`,
      });
    }
    const available = resolveStock(product, item.variantId);
    if (available < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${available} of "${product.name}" left in stock.`,
      });
    }

    const variant = item.variantId ? product.variants.id(item.variantId) : null;
    const price = variant?.price ?? product.discountPrice ?? product.price;
    const image = product.images?.[0]?.url;

    orderItems.push({
      product: product._id,
      variantId: item.variantId,
      name: product.name,
      image,
      price,
      quantity: item.quantity,
    });
    subtotal += price * item.quantity;
  }

  // ── Coupon (optional) ───────────────────────────────────────────────────
  // Validate now but do NOT increment usedCount yet.
  // usedCount is incremented only after admin verifies the payment.
  let discount = 0;
  let couponDoc = null;
  if (couponCode) {
    try {
      const result = await validateCouponForUser(couponCode, req.user._id, subtotal);
      discount = result.discount;
      couponDoc = result.coupon;
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  const shippingFee = subtotal - discount >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING_FEE;
  const total = subtotal - discount + shippingFee;

  // ── Reserve stock atomically ────────────────────────────────────────────
  const reserved = [];
  for (const item of cart.items) {
    const product = item.product;
    const updated = await reserveStock(product._id, item.variantId, item.quantity);
    if (!updated) {
      await Promise.all(reserved.map((r) => releaseStock(r.productId, r.variantId, r.quantity)));
      return res.status(409).json({
        success: false,
        message: `"${product.name}" just sold out. Please update your cart and try again.`,
      });
    }
    reserved.push({ productId: product._id, variantId: item.variantId, quantity: item.quantity });
  }

  // ── Create order ────────────────────────────────────────────────────────
  const order = await Order.create({
    orderNumber: generateOrderNumber(),
    user: req.user._id,
    items: orderItems,
    shippingAddress: {
      fullName: shippingAddress.fullName,
      phone: shippingAddress.phone,
      line1: shippingAddress.line1,
      line2: shippingAddress.line2,
      city: shippingAddress.city,
      state: shippingAddress.state,
      postalCode: shippingAddress.postalCode,
      country: shippingAddress.country || "India",
    },
    coupon: couponDoc?._id || null,
    subtotal,
    discount,
    shippingFee,
    total,
    paymentMethod,
    paymentStatus: "pending",
    status: "payment_pending",
    statusHistory: [{ status: "payment_pending", note: "Order created — awaiting payment" }],
  });

  res.status(201).json({ success: true, order });
});

// @desc    Get the logged-in customer's order history.
//          payment_pending orders without a proof submission are excluded —
//          they haven't been submitted yet and would clutter the list.
// @route   GET /api/orders/mine
// @access  Private
export const getMyOrders = asyncHandler(async (req, res) => {
  // Show payment_verification orders (proof submitted) but hide bare payment_pending
  const orders = await Order.find({
    user: req.user._id,
    status: { $ne: "payment_pending" },
  }).sort("-createdAt");
  res.status(200).json({ success: true, orders });
});

// @desc    Get a single order — owner or admin only
// @route   GET /api/orders/:id
// @access  Private
export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate("user", "name email")
    .populate("paymentRef");
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });

  const isOwner = order.user._id.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Not authorized to view this order." });
  }

  res.status(200).json({ success: true, order });
});

// @desc    Cancel an order (customer).
//          payment_pending orders are hard-deleted (stock released, no trace).
//          payment_verification orders: stock released, order marked cancelled,
//          screenshot kept for audit, payment marked failed.
//          placed/confirmed/processing: marked cancelled as before.
// @route   PATCH /api/orders/:id/cancel
// @access  Private
export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });
  if (order.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Not authorized to cancel this order." });
  }
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Orders that are already "${order.status}" can't be cancelled.`,
    });
  }

  // Release reserved stock
  await Promise.all(order.items.map((item) => releaseStock(item.product, item.variantId, item.quantity)));

  // Hard-delete bare payment_pending orders (no proof submitted yet)
  if (order.status === "payment_pending") {
    if (order.paymentRef) await Payment.findByIdAndDelete(order.paymentRef);
    await Order.findByIdAndDelete(order._id);
    return res.status(200).json({ success: true, deleted: true });
  }

  // For payment_verification and beyond: keep audit trail
  order.status = "cancelled";
  order.statusHistory.push({ status: "cancelled", note: "Cancelled by customer" });
  if (order.paymentStatus === "paid") order.paymentStatus = "refunded";
  await order.save();

  // Mark linked payment record as failed if it was still pending
  if (order.paymentRef) {
    await Payment.findByIdAndUpdate(order.paymentRef, {
      $set: {
        status: "failed",
        rejectionReason: "Cancelled by customer",
      },
    });
  }

  notify({
    user: order.user,
    type: "order_status",
    title: "Order cancelled",
    message: `Your order ${order.orderNumber} has been cancelled.`,
    link: `/orders/${order._id}`,
  });

  res.status(200).json({ success: true, order });
});

// @desc    List all orders — supports ?status= filter.
//          Admin only.
// @route   GET /api/orders
// @access  Private/Admin
export const getAllOrders = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const orders = await Order.find(filter)
    .populate("user", "name email")
    .populate("paymentRef")
    .sort("-createdAt");
  res.status(200).json({ success: true, count: orders.length, orders });
});

// @desc    Update order status / tracking number.
//          Admin only.  Handles restocking on cancellation/return.
// @route   PATCH /api/orders/:id/status
// @access  Private/Admin
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, trackingNumber, note } = req.body;
  const order = await Order.findById(req.params.id).populate("user", "name email");
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });

  const validStatuses = [
    "placed", "confirmed", "processing", "shipped", "delivered",
    "payment_failed", "cancelled", "returned",
  ];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status." });
  }

  if (status && status !== order.status) {
    // Restock if admin is cancelling/returning an order that was previously active
    if (
      ["cancelled", "returned", "payment_failed"].includes(status) &&
      !["cancelled", "returned", "payment_failed"].includes(order.status)
    ) {
      await Promise.all(
        order.items.map((item) => releaseStock(item.product, item.variantId, item.quantity))
      );
    }
    order.status = status;
    order.statusHistory.push({ status, note });

    if (status === "delivered" && order.paymentMethod === "cod") {
      order.paymentStatus = "paid";
    }
  }

  if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;
  await order.save();

  sendEmail({ to: order.user.email, ...orderStatusEmail(order, order.user.name) });
  notify({
    user: order.user._id,
    type: "order_status",
    title: "Order update",
    message: `Order ${order.orderNumber} is now ${order.status}.`,
    link: `/orders/${order._id}`,
  });

  res.status(200).json({ success: true, order });
});
