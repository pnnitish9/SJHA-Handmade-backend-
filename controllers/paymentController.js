import crypto from "crypto";
import Payment from "../models/Payment.js";
import Order from "../models/Order.js";
import CustomOrder from "../models/CustomOrder.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { notify } from "../utils/notify.js";

// @desc    Verify a Razorpay payment signature after checkout completes on
//          the frontend, and mark the order as paid + confirmed.
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

  if (!isValid) {
    payment.status = "failed";
    await payment.save();
    order.paymentStatus = "failed";
    await order.save();
    return res.status(400).json({ success: false, message: "Payment verification failed." });
  }

  payment.razorpayPaymentId = razorpay_payment_id;
  payment.razorpaySignature = razorpay_signature;
  payment.status = "verified";
  await payment.save();

  order.paymentStatus = "paid";
  order.status = "confirmed";
  order.statusHistory.push({ status: "confirmed", note: "Payment verified" });
  await order.save();

  // If this order originated from a custom order request, mark that request
  // as converted so the customer's custom orders list updates correctly.
  if (order.source === "custom" && order.customOrderRef) {
    await CustomOrder.findByIdAndUpdate(order.customOrderRef, { status: "converted" });
  }

  notify({
    user: order.user,
    type: "payment",
    title: "Payment received",
    message: `Payment for order ${order.orderNumber} was successful.`,
    link: `/orders/${order._id}`,
  });

  res.status(200).json({ success: true, message: "Payment verified.", order });
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
        if (order && order.paymentStatus !== "paid") {
          order.paymentStatus = "paid";
          if (order.status === "placed") {
            order.status = "confirmed";
            order.statusHistory.push({ status: "confirmed", note: "Payment confirmed via webhook" });
          }
          await order.save();

          // Flip custom order to converted if applicable
          if (order.source === "custom" && order.customOrderRef) {
            await CustomOrder.findByIdAndUpdate(order.customOrderRef, { status: "converted" });
          }
        }
      }
    }

    if (event.event === "payment.failed") {
      const razorpayOrderId = event.payload.payment.entity.order_id;
      const payment = await Payment.findOne({ razorpayOrderId });
      if (payment && payment.status === "created") {
        payment.status = "failed";
        await payment.save();

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
