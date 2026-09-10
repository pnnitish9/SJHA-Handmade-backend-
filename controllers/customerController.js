import User from "../models/User.js";
import Order from "../models/Order.js";
import { asyncHandler } from "../middleware/errorHandler.js";

// @desc    List all customer accounts (not admins)
// @route   GET /api/admin/customers
// @access  Private/Admin
export const getCustomers = asyncHandler(async (req, res) => {
  const customers = await User.find({ role: "customer" }).sort("-createdAt");
  res.status(200).json({ success: true, count: customers.length, customers });
});

// @desc    Get one customer's profile plus their order history
// @route   GET /api/admin/customers/:id
// @access  Private/Admin
export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await User.findOne({ _id: req.params.id, role: "customer" });
  if (!customer) return res.status(404).json({ success: false, message: "Customer not found." });

  const orders = await Order.find({ user: customer._id }).sort("-createdAt");

  res.status(200).json({ success: true, customer, orders });
});

// @desc    Activate or deactivate a customer account
// @route   PATCH /api/admin/customers/:id/status
// @access  Private/Admin
export const setCustomerStatus = asyncHandler(async (req, res) => {
  const customer = await User.findOne({ _id: req.params.id, role: "customer" });
  if (!customer) return res.status(404).json({ success: false, message: "Customer not found." });

  customer.isActive = req.body.isActive;
  await customer.save();

  res.status(200).json({ success: true, customer: customer.toSafeObject() });
});
