import crypto from "crypto";
import Cart from "../models/Cart.js";
import Payment from "../models/Payment.js";
import Order from "../models/Order.js";
import Coupon from "../models/Coupon.js";
import CustomOrder from "../models/CustomOrder.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { notify } from "../utils/notify.js";
import { sendEmail, orderConfirmationEmail } from "../utils/sendEmail.js";

// Shared helper — called both by verifyPayment (frontend-driven) and
// handleWebhook (async backstop) after a payment is confirmed as captured.
// Advances the order from payment_pending → placed → confirmed, clears the
// cart, increments the coupon usedCount, and fires notifications.
async function confirmOrder(order) {
  // Advance status
  order.paymentStatus = "paid";
  order.statusHistory.push({ status: "placed", note: "Payment received" });
  order.statusHistory.push({ status: "confirmed", note: "Payment verified" });
  order.status = "confirmed";
  await order.save();

  // Clear cart — it was kept alive while payment was pending so the
  // customer could retry; now that it's paid we can safely clear it.
  await Cart.findOneAndUpdate({ user: order.user }, { $set: { items: [] } });

  // Increment coupon usedCount now that the order is actually paid
  if (order.coupon) {
    await Coupon.findByIdAndUpdate(order.coupon, { $inc: { usedCount: 1 } });
  }

  // If this order originated from a custom order request, mark it converted
  if (order.source === "custom" && order.customOrderRef) {
    await CustomOrder.findByIdAndUpdate(order.customOrderRef, { status: "converted" });
  }

  // Non-blocking side effects — populate user for email if needed
  const populatedOrder = await order.populate("user", "name email");
  sendEmail({
    to: populatedOrder.user.email,
    ...orderConfirmationEmail(populatedOrder, populatedOrder.user.name),
  });

  notify({
    user: order.user,
    type: "order_placed",
    title: "Order placed",
    message: `Your order ${order.orderNumber} has been placed successfully.`,
    link: `/orders/${order._id}`,
  });

  notify({
    user: order.user,
    type: "payment",
    title: "Payment received",
    message: `Payment for order ${order.orderNumber} was successful.`,
    link: `/orders/${order._id}`,
  });
}

// @desc    Verify a Razorpay payment signature after the Razorpay modal
//          completes successfully on the frontend.  On success the order
//          advances from payment_pending → confirmed, the cart is cleared,
//          and confirmation email / notifications are sent.
//          On failure the order is NOT deleted here — we leave it in
//          payment_pending so the customer can retry from the order detail
//          page via GET /api/orders/:id/retry-payment.
// @route   POST /api/payments/verify
// @access  Private
export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
    return res.status(400).json({ success: false, message: "Missing payment verification details." });
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
  if (!payment) {
    return res.status(404).json({ success: false, message: "Payment record not found." });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found." });
  }
  if (order.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Not authorized." });
  }

  // Guard: if this order was already confirmed (e.g. webhook beat us here),
  // just return success — idempotent.
  if (order.paymentStatus === "paid") {
    return res.status(200).json({ success: true, message: "Payment already verified.", order });
  }

  if (!isValid) {
    // Signature mismatch — mark payment failed but keep the order in
    // payment_pending so the customer can retry.
    payment.status = "failed";
    await payment.save();
    order.paymentStatus = "failed";
    await order.save();
    return res.status(400).json({ success: false, message: "Payment verification failed. You can retry payment from your order page." });
  }

  // Signature valid — record payment details and confirm the order
  payment.razorpayPaymentId = razorpay_payment_id;
  payment.razorpaySignature = razorpay_signature;
  payment.status = "verified";
  await payment.save();

  await confirmOrder(order);

  // Re-fetch with populated user so the response has full order data
  const confirmedOrder = await Order.findById(order._id);
  res.status(200).json({ success: true, message: "Payment verified.", order: confirmedOrder });
});

// @desc    Razorpay webhook — asynchronous backstop for payment events
//          (payment.captured / payment.failed). Catches cases the
//          frontend-driven /verify flow misses, e.g. the customer closing
//          the tab right after paying, before the success handler runs.
//          Mounted with express.raw() in server.js so req.body is the raw
//          buffer the signature was computed over — express.json() would
//          re-serialize it and break the HMAC check.
// @route   POST /api/payments/webhook
// @access  Public (authenticated via the Razorpay webhook signature)
export const handleWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook.");
    return res.status(500).json({ success: false, message: "Webhook not configured." });
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  if (expectedSignature !== signature) {
    return res.status(400).json({ success: false, message: "Invalid webhook signature." });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ success: false, message: "Invalid payload." });
  }

  try {
    if (event.event === "payment.captured") {
      const razorpayOrderId = event.payload.payment.entity.order_id;
      const payment = await Payment.findOne({ razorpayOrderId });

      if (payment && payment.status !== "verified") {
        payment.status = "verified";
        payment.razorpayPaymentId = event.payload.payment.entity.id;
        await payment.save();

        const order = await Order.findById(payment.order);
        // Only advance if not already confirmed — prevents double-processing
        // when both /verify and the webhook fire for the same payment.
        if (order && order.paymentStatus !== "paid") {
          await confirmOrder(order);
        }
      }
    }

    if (event.event === "payment.failed") {
      const razorpayOrderId = event.payload.payment.entity.order_id;
      const payment = await Payment.findOne({ razorpayOrderId });

      if (payment && payment.status === "created") {
        payment.status = "failed";
        await payment.save();

        // Keep the order in payment_pending with paymentStatus=failed so
        // the customer can retry from the order detail page.
        const order = await Order.findById(payment.order);
        if (order && order.paymentStatus === "pending") {
          order.paymentStatus = "failed";
          await order.save();
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(`Webhook processing error: ${error.message}`);
    // Still acknowledge receipt so Razorpay doesn't retry indefinitely on our bug
    res.status(200).json({ success: true });
  }
};
