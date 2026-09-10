import CustomOrder from "../models/CustomOrder.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { uploadManyToCloudinary } from "../utils/cloudinaryUpload.js";
import { notify } from "../utils/notify.js";
import { sendEmail } from "../utils/sendEmail.js";

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

  res.status(201).json({ success: true, customOrder });
});

// @desc    List the logged-in customer's custom order requests
// @route   GET /api/custom-orders/mine
// @access  Private
export const getMyCustomOrders = asyncHandler(async (req, res) => {
  const customOrders = await CustomOrder.find({ customer: req.user._id }).sort("-createdAt");
  res.status(200).json({ success: true, customOrders });
});

// @desc    List every custom order request
// @route   GET /api/custom-orders
// @access  Private/Admin
export const getAllCustomOrders = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const customOrders = await CustomOrder.find(filter).populate("customer", "name email").sort("-createdAt");
  res.status(200).json({ success: true, customOrders });
});

// @desc    Admin responds to / updates the status of a custom order request
// @route   PATCH /api/custom-orders/:id
// @access  Private/Admin
export const respondToCustomOrder = asyncHandler(async (req, res) => {
  const { status, adminNotes } = req.body;
  const customOrder = await CustomOrder.findById(req.params.id).populate("customer", "name email");
  if (!customOrder) return res.status(404).json({ success: false, message: "Request not found." });

  const validStatuses = ["submitted", "in_discussion", "approved", "rejected", "converted"];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status." });
  }

  if (status) customOrder.status = status;
  if (adminNotes !== undefined) customOrder.adminNotes = adminNotes;
  await customOrder.save();

  if (status) {
    notify({
      user: customOrder.customer._id,
      type: "custom_order",
      title: "Custom order update",
      message: `Your custom order request is now "${status.replace("_", " ")}".`,
      link: `/custom-orders/${customOrder._id}`,
    });
    sendEmail({
      to: customOrder.customer.email,
      subject: `Your custom order request is now ${status.replace("_", " ")}`,
      html: `<p>Hi ${customOrder.customer.name},</p><p>Your custom order request ("${customOrder.productType}") is now <strong>${status.replace("_", " ")}</strong>.</p>${adminNotes ? `<p>Note from us: ${adminNotes}</p>` : ""}<p>— SJHA Handmade</p>`,
    });
  }

  res.status(200).json({ success: true, customOrder });
});
