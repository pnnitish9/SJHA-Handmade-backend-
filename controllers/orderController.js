import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { generateOrderNumber } from "../utils/generateOrderNumber.js";
import { validateCouponForUser } from "../utils/couponValidation.js";
import { sendEmail, orderConfirmationEmail, orderStatusEmail } from "../utils/sendEmail.js";
import { notify } from "../utils/notify.js";
import { reserveStock, releaseStock } from "../utils/stockOps.js";
import razorpay from "../config/razorpay.js";

const CANCELLABLE_STATUSES = ["payment_pending", "placed", "confirmed", "processing"];
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
//          For Razorpay orders the order stays in "payment_pending" status
//          until the frontend calls POST /api/payments/verify.  The cart is
//          intentionally NOT cleared here so the customer can retry if they
//          cancel or if payment fails.  Stock is reserved atomically so
//          inventory doesn't oversell while the Razorpay modal is open.
// @route   POST /api/orders
// @access  Private
export const createOrder = asyncHandler(async (req, res) => {
  const { addressId, shippingAddress: rawAddress, paymentMethod, couponCode } = req.body;

  if (!["razorpay", "cod"].includes(paymentMethod)) {
    return res.status(400).json({ success: false, message: "Invalid payment method." });
  }

  // Resolve shipping address: either a saved address id, or a fresh one in the body
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

  const cart = await Cart.findOne({ user: req.user._id }).populate("items.product");
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ success: false, message: "Your cart is empty." });
  }

  // Validate stock and snapshot each line item
  const orderItems = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const product = item.product;
    if (!product || !product.isAvailable) {
      return res.status(400).json({ success: false, message: `${product?.name || "A product"} is no longer available.` });
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

  // Coupon (optional) — validate now but do NOT increment usedCount yet.
  // usedCount is incremented only after payment is confirmed so a coupon
  // isn't consumed by a cancelled/failed payment attempt.
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

  // Reserve stock atomically — reserveStock() only succeeds if enough stock
  // is still available at the moment of the update, closing the race window
  // that a read-then-save pattern would leave open under concurrent checkouts.
  // If any item fails (someone else bought the last unit first), roll back
  // every item already reserved in this loop before returning the error.
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

  // Create the order in "payment_pending" state.  It will advance to
  // "placed" → "confirmed" only after payment is verified.
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
    statusHistory: [{ status: "payment_pending", note: "Awaiting payment" }],
  });

  // For Razorpay: create the Razorpay order and a local Payment record.
  // The cart is NOT cleared here — it is cleared only after verifyPayment
  // succeeds so the customer keeps their cart if they cancel or payment fails.
  let razorpayOrder = null;
  if (paymentMethod === "razorpay") {
    try {
      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(total * 100), // paise
        currency: "INR",
        receipt: order.orderNumber,
      });
      const payment = await Payment.create({
        order: order._id,
        user: req.user._id,
        razorpayOrderId: razorpayOrder.id,
        amount: total,
        status: "created",
      });
      order.paymentRef = payment._id;
      await order.save();
    } catch (err) {
      console.error(`Razorpay order creation failed: ${err.message}`);
      // Compensate: release reserved stock and delete the dangling order so
      // the customer can try again cleanly.
      await Promise.all(reserved.map((r) => releaseStock(r.productId, r.variantId, r.quantity)));
      await Order.findByIdAndDelete(order._id);
      return res.status(502).json({ success: false, message: "Could not initiate payment. Please try again." });
    }
  }

  // COD orders are immediately confirmed — clear cart, increment coupon, notify.
  if (paymentMethod === "cod") {
    order.status = "placed";
    order.statusHistory.push({ status: "placed", note: "Order placed by customer (COD)" });
    await order.save();

    if (couponDoc) {
      couponDoc.usedCount += 1;
      await couponDoc.save();
    }
    cart.items = [];
    await cart.save();

    sendEmail({ to: req.user.email, ...orderConfirmationEmail(order, req.user.name) });
    notify({
      user: req.user._id,
      type: "order_placed",
      title: "Order placed",
      message: `Your order ${order.orderNumber} has been placed.`,
      link: `/orders/${order._id}`,
    });
  }

  res.status(201).json({
    success: true,
    order,
    razorpay: razorpayOrder
      ? { orderId: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, keyId: process.env.RAZORPAY_KEY_ID }
      : null,
  });
});

// @desc    Get the logged-in customer's order history
//          payment_pending orders are excluded — they haven't been paid yet
//          and should not appear in the order history.
// @route   GET /api/orders/mine
// @access  Private
export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id, status: { $ne: "payment_pending" } }).sort("-createdAt");
  res.status(200).json({ success: true, orders });
});

// @desc    Get a single order — owner or admin only
// @route   GET /api/orders/:id
// @access  Private
export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate("user", "name email");
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });

  const isOwner = order.user._id.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Not authorized to view this order." });
  }

  res.status(200).json({ success: true, order });
});

// @desc    Retry payment for a payment_pending Razorpay order.
//          Returns the stored Razorpay order details so the frontend can
//          reopen the payment modal without creating a new order.
// @route   GET /api/orders/:id/retry-payment
// @access  Private (order owner only)
export const retryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate("paymentRef");
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });
  if (order.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Not authorized." });
  }
  if (order.status !== "payment_pending" || order.paymentStatus !== "pending") {
    return res.status(400).json({ success: false, message: "This order is not awaiting payment." });
  }
  const payment = order.paymentRef;
  if (!payment?.razorpayOrderId) {
    return res.status(400).json({ success: false, message: "Payment record not found for this order." });
  }
  res.status(200).json({
    success: true,
    order,
    razorpay: {
      orderId: payment.razorpayOrderId,
      amount: Math.round(order.total * 100),
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
    },
  });
});

// @desc    Cancel an order (customer) — only while it's still cancellable
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

  // Restock every item atomically
  await Promise.all(order.items.map((item) => releaseStock(item.product, item.variantId, item.quantity)));

  // payment_pending orders haven't been confirmed — delete them outright so
  // they never appear in order history.  For already-placed orders keep the
  // record but mark it cancelled so the admin has an audit trail.
  if (order.status === "payment_pending") {
    await Payment.findByIdAndDelete(order.paymentRef);
    await Order.findByIdAndDelete(order._id);
    return res.status(200).json({ success: true, deleted: true });
  }

  order.status = "cancelled";
  order.statusHistory.push({ status: "cancelled", note: "Cancelled by customer" });
  if (order.paymentStatus === "paid") order.paymentStatus = "refunded";
  await order.save();

  notify({
    user: order.user,
    type: "order_status",
    title: "Order cancelled",
    message: `Your order ${order.orderNumber} has been cancelled.`,
    link: `/orders/${order._id}`,
  });

  res.status(200).json({ success: true, order });
});

// @desc    List all orders — supports ?status= filter
// @route   GET /api/orders
// @access  Private/Admin
export const getAllOrders = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const orders = await Order.find(filter).populate("user", "name email").sort("-createdAt");
  res.status(200).json({ success: true, count: orders.length, orders });
});

// @desc    Update order status / tracking number
// @route   PATCH /api/orders/:id/status
// @access  Private/Admin
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, trackingNumber, note } = req.body;
  const order = await Order.findById(req.params.id).populate("user", "name email");
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });

  const validStatuses = ["placed", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status." });
  }

  if (status && status !== order.status) {
    // Restock if admin is cancelling/returning an order that hadn't been already
    if (["cancelled", "returned"].includes(status) && !["cancelled", "returned"].includes(order.status)) {
      await Promise.all(order.items.map((item) => releaseStock(item.product, item.variantId, item.quantity)));
    }
    order.status = status;
    order.statusHistory.push({ status, note });

    if (status === "delivered" && order.paymentMethod === "cod") {
      order.paymentStatus = "paid"; // COD is collected on delivery
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
