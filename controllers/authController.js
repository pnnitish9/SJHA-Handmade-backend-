import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { sendTokenResponse } from "../utils/generateToken.js";

// @desc    Register a new customer account
// @route   POST /api/auth/register
// @access  Public
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({ success: false, message: "An account with this email already exists." });
  }

  // role is always forced to "customer" here — admins are never created via public signup
  const user = await User.create({ name, email, password, phone, role: "customer" });

  sendTokenResponse(user, 201, res);
});

// @desc    Login (customer or admin)
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ success: false, message: "Invalid email or password." });
  }

  if (!user.isActive) {
    return res.status(403).json({ success: false, message: "This account has been deactivated." });
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  sendTokenResponse(user, 200, res);
});

// @desc    Logout — clears the auth cookie
// @route   POST /api/auth/logout
// @access  Private
export const logout = asyncHandler(async (req, res) => {
  // Must match the same flags used when setting the cookie in sendTokenResponse,
  // otherwise the browser won't clear the original cookie.
  res.cookie("token", "none", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
  res.status(200).json({ success: true, message: "Logged out successfully." });
});

// @desc    Get the logged-in user's profile
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, user: req.user.toSafeObject() });
});

// @desc    Update profile fields (name, phone, avatar)
// @route   PATCH /api/auth/me
// @access  Private
export const updateMe = asyncHandler(async (req, res) => {
  const allowedFields = ["name", "phone"];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({ success: true, user: user.toSafeObject() });
});

// @desc    Change password while logged in
// @route   PATCH /api/auth/update-password
// @access  Private
export const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select("+password");
  if (!(await user.comparePassword(currentPassword))) {
    return res.status(401).json({ success: false, message: "Current password is incorrect." });
  }

  user.password = newPassword;
  await user.save();

  sendTokenResponse(user, 200, res);
});

// @desc    Add a shipping/billing address
// @route   POST /api/auth/addresses
// @access  Private
export const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (req.body.isDefault) {
    user.addresses.forEach((addr) => (addr.isDefault = false));
  }

  user.addresses.push(req.body);
  await user.save();

  res.status(201).json({ success: true, addresses: user.addresses });
});

// @desc    Remove an address
// @route   DELETE /api/auth/addresses/:addressId
// @access  Private
export const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  user.addresses = user.addresses.filter(
    (addr) => addr._id.toString() !== req.params.addressId
  );
  await user.save();

  res.status(200).json({ success: true, addresses: user.addresses });
});
