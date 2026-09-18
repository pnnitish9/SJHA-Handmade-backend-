import Cart from "../models/Cart.js";
import Payment from "../models/Payment.js";
import Order from "../models/Order.js";
import Coupon from "../models/Coupon.js";
import CustomOrder from "../models/CustomOrder.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { notify } from "../utils/notify.js";
import { sendEmail, paymentVerifiedEmail, paymentRejectedEmail } from "../utils/sendEmail.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";
import { releaseStock } from "../utils/stockOps.js";

// ── Shared helper ──────────────────────────────────────────────────────────
// Called by adminVerifyPayment after signature / manual check is confirmed.
// Advances order to confirmed, clears cart, increments coupon, notifies user.
async function confirmOrder(order, adminId) {
  order.paymentStatus = "paid";
  order.statusHistory.push({ status: "confirmed", note: "Payment verified by admin" });
  order.status = "confirmed";
  await order.save();

  // Clear the cart now that the order is definitively placed
  await Cart.findOneAndUpdate({ user: order.user }, { $set: { items: [] } });

  // Increment coupon usedCount only after payment is confirmed
  if (order.coupon) {
    await Coupon.findByIdAndUpdate(order.coupon, { $inc: { usedCount: 1 } });
  }

  // If this order originated from a custom order request, mark it converted
  if (order.source === "custom" && order.customOrderRef) {
    await CustomOrder.findByIdAndUpdate(order.customOrderRef, { status: "converted" });
  }

  // Non-blocking: send confirmation email & notifications
  const populatedOrder = await order.populate("user", "name email");
  sendEmail({
    to: populatedOrder.user.email,
    ...paymentVerifiedEmail(populatedOrder, populatedOrder.user.name),
  });

  notify({
    user: order.user,
    type: "order_placed",
    title: "Order confirmed",
    message: `Your order ${order.orderNumber} has been confirmed.`,
    link: `/orders/${order._id}`,
  });

  notify({
    user: order.user,
    type: "payment",
    title: "Payment verified",
    message: `Your payment for order ${order.orderNumber} has been verified.`,
    link: `/orders/${order._id}`,
  });
}

// ── Public UPI config ──────────────────────────────────────────────────────

// @desc    Return the public UPI configuration the frontend needs to render
//          the QR code and payment instructions.  Only public information is
//          returned — no secrets are exposed.
// @route   GET /api/payments/config
// @access  Public
export const getPaymentConfig = asyncHandler(async (req, res) => {
  const upiId = process.env.UPI_ID || "";
  const upiName = process.env.UPI_NAME || "SJHA Handmade";

  res.status(200).json({
    success: true,
    config: { upiId, upiName },
  });
});

// ── Customer: submit payment proof ────────────────────────────────────────

// @desc    Customer submits UPI payment screenshot + transaction details.
//          Advances order from payment_pending → payment_verification.
//          The amount entered by the customer is validated against the
//          server-calculated order total — we never trust frontend totals.
// @route   POST /api/orders/:orderId/payment-proof
// @access  Private (order owner)
export const submitPaymentProof = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found." });
  }

  // Ownership check
  if (order.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to submit payment proof for this order.",
    });
  }

  // State guards
  if (order.status === "cancelled" || order.status === "payment_failed") {
    return res.status(400).json({
      success: false,
      message: "Payment proof cannot be submitted for a cancelled or failed order.",
    });
  }
  if (order.status === "payment_verification") {
    return res.status(400).json({
      success: false,
      message: "Payment proof has already been submitted. Please wait for admin verification.",
    });
  }
  if (!["payment_pending"].includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: "This order is not awaiting payment proof.",
    });
  }

  // ── Validate required fields ─────────────────────────────────────────────
  const {
    transactionId,
    payerName,
    payerPhone,
    bankName,
    paymentDate,
    paymentTime,
    upiMode, // PhonePe / Google Pay / Paytm / Other
  } = req.body;

  const missingFields = [];
  if (!transactionId?.trim()) missingFields.push("UTR / Transaction ID");
  if (!payerName?.trim())     missingFields.push("Name");
  if (!paymentDate)           missingFields.push("Payment date");
  if (!paymentTime?.trim())   missingFields.push("Payment time");
  if (!upiMode?.trim())       missingFields.push("Payment mode");
  if (!bankName?.trim())      missingFields.push("Bank name");

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Missing required fields: ${missingFields.join(", ")}.`,
    });
  }

  // ── Duplicate UTR check ───────────────────────────────────────────────────
  // Reject if the same transaction ID is already linked to a verified payment.
  const cleanUTR = transactionId.trim();
  const duplicate = await Payment.findOne({
    transactionId: cleanUTR,
    status: "verified",
  });
  if (duplicate) {
    return res.status(400).json({
      success: false,
      message: "This transaction ID has already been used for a verified payment.",
    });
  }

  // ── Upload screenshot to Cloudinary (required) ───────────────────────────
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please upload a screenshot of your payment.",
    });
  }

  let screenshotData = {};
  try {
    const result = await uploadBufferToCloudinary(req.file.buffer, "payment-proofs");
    screenshotData = { url: result.secure_url, publicId: result.public_id };
  } catch (err) {
    console.error(`Screenshot upload failed: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Failed to upload payment screenshot. Please try again.",
    });
  }

  // ── Create / update Payment record ───────────────────────────────────────
  // bankName stores "PhonePe — HDFC Bank" style so admin sees both in one place.
  const fullBankName = upiMode?.trim()
    ? `${upiMode.trim()} — ${bankName.trim()}`
    : bankName.trim();

  const paymentData = {
    order: order._id,
    user: req.user._id,
    method: "upi_manual",
    amount: order.total,          // always use server-calculated total
    currency: "INR",
    status: "verification_pending",
    payerName: payerName.trim(),
    payerPhone: payerPhone?.trim() || "",
    bankName: fullBankName,
    transactionId: cleanUTR,
    paymentDate: new Date(paymentDate),
    paymentTime: paymentTime.trim(),
    screenshot: screenshotData,
  };

  let payment;
  if (order.paymentRef) {
    // If a payment record already exists (e.g. from a previous failed attempt),
    // update it rather than creating a duplicate.
    payment = await Payment.findByIdAndUpdate(order.paymentRef, paymentData, {
      new: true,
      runValidators: true,
    });
  } else {
    payment = await Payment.create(paymentData);
    order.paymentRef = payment._id;
  }

  // ── Advance order status ──────────────────────────────────────────────────
  order.paymentStatus = "verification_pending";
  order.status = "payment_verification";
  order.statusHistory.push({
    status: "payment_verification",
    note: `Payment proof submitted — UTR: ${cleanUTR}`,
  });
  await order.save();

  // ── Notify customer ───────────────────────────────────────────────────────
  notify({
    user: order.user,
    type: "payment",
    title: "Payment proof submitted",
    message: `Your payment proof for order ${order.orderNumber} has been submitted and is pending verification.`,
    link: `/orders/${order._id}`,
  });

  res.status(200).json({
    success: true,
    message: "Payment proof submitted successfully. Your payment is pending verification.",
    order,
    payment,
  });
});

// ── Admin: list pending payments ──────────────────────────────────────────

// @desc    Return all payments awaiting admin verification, newest first.
//          Supports ?tab=pending|verified|rejected for the admin UI tabs.
// @route   GET /api/payments/pending
// @access  Private/Admin
export const getPendingPayments = asyncHandler(async (req, res) => {
  const tab = req.query.tab || "pending";

  const statusMap = {
    pending: "verification_pending",
    verified: "verified",
    rejected: "rejected",
  };

  const statusFilter = statusMap[tab] || "verification_pending";

  const payments = await Payment.find({ status: statusFilter, method: "upi_manual" })
    .populate({
      path: "order",
      populate: { path: "user", select: "name email phone" },
    })
    .populate("user", "name email phone")
    .populate("verifiedBy", "name")
    .sort("-createdAt");

  res.status(200).json({ success: true, count: payments.length, payments });
});

// ── Admin: verify payment ─────────────────────────────────────────────────

// @desc    Admin approves a UPI payment after manually checking the
//          merchant account.  Advances order to confirmed, clears cart.
//          Idempotent — returns early if already verified.
// @route   PATCH /api/payments/:paymentId/verify
// @access  Private/Admin
export const adminVerifyPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.paymentId);
  if (!payment) {
    return res.status(404).json({ success: false, message: "Payment record not found." });
  }
  if (payment.status === "verified") {
    return res.status(400).json({ success: false, message: "This payment has already been verified." });
  }
  if (payment.status !== "verification_pending") {
    return res.status(400).json({
      success: false,
      message: "Payment is no longer pending verification.",
    });
  }

  const order = await Order.findById(payment.order);
  if (!order) {
    return res.status(404).json({ success: false, message: "Associated order not found." });
  }

  // Mark payment verified
  payment.status = "verified";
  payment.verifiedBy = req.user._id;
  payment.verifiedAt = new Date();
  await payment.save();

  // Confirm the order (clears cart, increments coupon, sends email, notifies)
  await confirmOrder(order, req.user._id);

  const updatedOrder = await Order.findById(order._id);
  res.status(200).json({
    success: true,
    message: "Payment verified. Order confirmed.",
    payment,
    order: updatedOrder,
  });
});

// ── Admin: reject payment ─────────────────────────────────────────────────

// @desc    Admin rejects a UPI payment.  Restores reserved inventory,
//          marks order as payment_failed, and notifies the customer.
// @route   PATCH /api/payments/:paymentId/reject
// @access  Private/Admin
export const adminRejectPayment = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) {
    return res.status(400).json({ success: false, message: "A rejection reason is required." });
  }

  const payment = await Payment.findById(req.params.paymentId);
  if (!payment) {
    return res.status(404).json({ success: false, message: "Payment record not found." });
  }
  if (payment.status === "verified") {
    return res.status(400).json({ success: false, message: "Cannot reject an already verified payment." });
  }
  if (payment.status !== "verification_pending") {
    return res.status(400).json({
      success: false,
      message: "Payment is no longer pending verification.",
    });
  }

  const order = await Order.findById(payment.order).populate("user", "name email");
  if (!order) {
    return res.status(404).json({ success: false, message: "Associated order not found." });
  }

  // Mark payment rejected
  payment.status = "rejected";
  payment.rejectionReason = reason.trim();
  payment.verifiedBy = req.user._id;
  payment.verifiedAt = new Date();
  await payment.save();

  // Release reserved stock so items go back on sale
  await Promise.all(
    order.items.map((item) => releaseStock(item.product, item.variantId, item.quantity))
  );

  // Advance order to payment_failed
  order.paymentStatus = "rejected";
  order.status = "payment_failed";
  order.statusHistory.push({
    status: "payment_failed",
    note: `Payment rejected by admin. Reason: ${reason.trim()}`,
  });
  await order.save();

  // Notify customer
  sendEmail({
    to: order.user.email,
    ...paymentRejectedEmail(order, order.user.name, reason.trim()),
  });

  notify({
    user: order.user._id,
    type: "payment",
    title: "Payment rejected",
    message: `Your payment for order ${order.orderNumber} could not be verified. Reason: ${reason.trim()}`,
    link: `/orders/${order._id}`,
  });

  res.status(200).json({
    success: true,
    message: "Payment rejected.",
    payment,
    order,
  });
});
