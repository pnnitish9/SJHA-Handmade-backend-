import mongoose from "mongoose";
import CustomOrder from "../models/CustomOrder.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import razorpay from "../config/razorpay.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { uploadManyToCloudinary } from "../utils/cloudinaryUpload.js";
import { notify } from "../utils/notify.js";
import { sendEmail } from "../utils/sendEmail.js";
import { generateOrderNumber } from "../utils/generateOrderNumber.js";

// @desc    Submit a custom order request (with optional reference images)
// @route   POST /api/custom-orders
// @access  Private
export const createCustomOrder = asyncHandler(async (req, res) => {
  const { productType, preferredColor, preferredSize, budget, description } = req.body;

  let referenceImages = [];
  if (req.files?.length) {
    referenceImages = await uploadManyToCloudinary(req.files, "sjha-handmade/custom-orders");
  }

  const customOrder = await CustomOrder.create({
    customer: req.user._id,
    productType,
    preferredColor,
    preferredSize,
    budget: budget || undefined,
    description,
    referenceImages,
  });

  notify({
    user: req.user._id,
    type: "custom_order",
    title: "Custom order submitted",
    message: `Your request for "${productType}" has been submitted. We'll review it soon.`,
    link: `/custom-orders`,
  });

  res.status(201).json({ success: true, customOrder });
});

// @desc    List the logged-in customer's custom order requests
// @route   GET /api/custom-orders/mine
// @access  Private
export const getMyCustomOrders = asyncHandler(async (req, res) => {
  const customOrders = await CustomOrder.find({ customer: req.user._id })
    .populate("convertedOrder", "orderNumber status paymentStatus")
    .sort("-createdAt");
  res.status(200).json({ success: true, customOrders });
});

// @desc    List every custom order request
// @route   GET /api/custom-orders
// @access  Private/Admin
export const getAllCustomOrders = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const customOrders = await CustomOrder.find(filter)
    .populate("customer", "name email")
    .populate("convertedOrder", "orderNumber status")
    .sort("-createdAt");
  res.status(200).json({ success: true, customOrders });
});

// @desc    Admin responds to / updates a custom order request.
//          When approving, quotedPrice is required — it will be shown to the
//          customer on their Pay Now button.
// @route   PATCH /api/custom-orders/:id
// @access  Private/Admin
export const respondToCustomOrder = asyncHandler(async (req, res) => {
  const { status, adminNotes, quotedPrice } = req.body;
  const customOrder = await CustomOrder.findById(req.params.id).populate("customer", "name email");
  if (!customOrder) return res.status(404).json({ success: false, message: "Request not found." });

  const validStatuses = ["submitted", "in_discussion", "approved", "rejected", "converted"];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status." });
  }

  // quotedPrice is mandatory when approving
  if (status === "approved") {
    const price = Number(quotedPrice);
    if (!price || price <= 0) {
      return res.status(400).json({
        success: false,
        message: "A quoted price (> 0) is required when approving a custom order.",
      });
    }
    customOrder.quotedPrice = price;
  }

  if (status) customOrder.status = status;
  if (adminNotes !== undefined) customOrder.adminNotes = adminNotes;
  await customOrder.save();

  if (status) {
    const statusLabel = status.replace(/_/g, " ");
    notify({
      user: customOrder.customer._id,
      type: "custom_order",
      title: "Custom order update",
      message:
        status === "approved"
          ? `Your custom order for "${customOrder.productType}" has been approved! Tap to pay.`
          : `Your custom order request is now "${statusLabel}".`,
      link: `/custom-orders`,
    });
    sendEmail({
      to: customOrder.customer.email,
      subject: `Your custom order request is now ${statusLabel}`,
      html: `
        <p>Hi ${customOrder.customer.name},</p>
        <p>Your custom order request ("<strong>${customOrder.productType}</strong>") is now <strong>${statusLabel}</strong>.</p>
        ${status === "approved" && customOrder.quotedPrice
          ? `<p><strong>Quoted price: ₹${customOrder.quotedPrice}</strong> — please log in and complete your payment to confirm the order.</p>`
          : ""}
        ${adminNotes ? `<p><strong>Note from us:</strong> ${adminNotes}</p>` : ""}
        <p>— handmade_s.jha</p>
      `,
    });
  }

  res.status(200).json({ success: true, customOrder });
});

// @desc    Customer initiates Razorpay payment for an approved custom order.
//          Creates a real Order document (source: "custom") + a Razorpay order,
//          then returns the Razorpay credentials to the frontend.
//          The order stays in "placed / paymentStatus: pending" until
//          /api/payments/verify is called after the customer pays.
// @route   POST /api/custom-orders/:id/initiate-payment
// @access  Private
export const initiateCustomOrderPayment = asyncHandler(async (req, res) => {
  const customOrder = await CustomOrder.findById(req.params.id);
  if (!customOrder) {
    return res.status(404).json({ success: false, message: "Custom order not found." });
  }
  if (customOrder.customer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Not authorized." });
  }
  if (customOrder.status !== "approved") {
    return res.status(400).json({
      success: false,
      message: "This custom order has not been approved yet.",
    });
  }
  if (!customOrder.quotedPrice) {
    return res.status(400).json({
      success: false,
      message: "No quoted price set for this custom order.",
    });
  }
  if (customOrder.convertedOrder) {
    // Payment was already initiated — return the existing order so the
    // frontend can re-open Razorpay if the customer closed it without paying.
    const existingOrder = await Order.findById(customOrder.convertedOrder);
    const existingPayment = await Payment.findOne({ order: existingOrder._id });
    if (existingOrder && existingPayment && existingOrder.paymentStatus === "pending") {
      // Re-create a fresh Razorpay order (the old one may have expired)
      const rzpOrder = await razorpay.orders.create({
        amount: Math.round(customOrder.quotedPrice * 100),
        currency: "INR",
        receipt: existingOrder.orderNumber,
      });
      existingPayment.razorpayOrderId = rzpOrder.id;
      await existingPayment.save();

      return res.status(200).json({
        success: true,
        order: existingOrder,
        razorpay: {
          orderId: rzpOrder.id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
        },
      });
    }
    // Already paid — nothing to do
    return res.status(400).json({
      success: false,
      message: "This custom order has already been paid for.",
    });
  }

  // Build a shipping address from the customer's saved default address
  // (or a minimal placeholder so the Order schema is satisfied).
  const customer = req.user;
  const defaultAddr = customer.addresses?.find((a) => a.isDefault) || customer.addresses?.[0];
  const shippingAddress = defaultAddr
    ? {
        fullName: defaultAddr.fullName,
        phone: defaultAddr.phone,
        line1: defaultAddr.line1,
        line2: defaultAddr.line2,
        city: defaultAddr.city,
        state: defaultAddr.state,
        postalCode: defaultAddr.postalCode,
        country: defaultAddr.country || "India",
      }
    : {
        fullName: customer.name,
        phone: customer.phone || "",
        line1: "To be confirmed",
        city: "To be confirmed",
        state: "",
        postalCode: "",
        country: "India",
      };

  const orderNumber = generateOrderNumber();

  // Create the real Order — items array holds a single synthetic line item
  // describing the custom piece so it shows properly in order history.
  const order = await Order.create({
    orderNumber,
    user: req.user._id,
    items: [
      {
        product: new mongoose.Types.ObjectId(), // synthetic — no real product doc
        name: customOrder.productType,
        image: customOrder.referenceImages?.[0]?.url || "",
        price: customOrder.quotedPrice,
        quantity: 1,
      },
    ],
    shippingAddress,
    subtotal: customOrder.quotedPrice,
    discount: 0,
    shippingFee: 0,
    total: customOrder.quotedPrice,
    paymentMethod: "razorpay",
    paymentStatus: "pending",
    status: "placed",
    statusHistory: [{ status: "placed", note: "Custom order — awaiting payment" }],
    source: "custom",
    customOrderRef: customOrder._id,
  });

  // Create Razorpay order
  const rzpOrder = await razorpay.orders.create({
    amount: Math.round(customOrder.quotedPrice * 100), // paise
    currency: "INR",
    receipt: orderNumber,
  });

  const payment = await Payment.create({
    order: order._id,
    user: req.user._id,
    razorpayOrderId: rzpOrder.id,
    amount: customOrder.quotedPrice,
    status: "created",
  });

  order.paymentRef = payment._id;
  await order.save();

  // Link the real order back to the custom order request
  customOrder.convertedOrder = order._id;
  await customOrder.save();

  res.status(201).json({
    success: true,
    order,
    razorpay: {
      orderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    },
  });
});
