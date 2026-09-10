import Coupon from "../models/Coupon.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateCouponForUser } from "../utils/couponValidation.js";

// @desc    Validate a coupon against the caller's current cart subtotal
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  try {
    const { coupon, discount } = await validateCouponForUser(code, req.user._id, Number(subtotal));
    res.status(200).json({
      success: true,
      coupon: { id: coupon._id, code: coupon.code, discountType: coupon.discountType },
      discount,
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
});

// @desc    List all coupons
// @route   GET /api/coupons
// @access  Private/Admin
export const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort("-createdAt");
  res.status(200).json({ success: true, coupons });
});

// @desc    Create a coupon
// @route   POST /api/coupons
// @access  Private/Admin
export const createCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    description,
    discountType,
    discountValue,
    minOrderValue,
    maxDiscountAmount,
    usageLimit,
    perUserLimit,
    expiresAt,
  } = req.body;

  const existing = await Coupon.findOne({ code: code.toUpperCase() });
  if (existing) {
    return res.status(409).json({ success: false, message: "A coupon with this code already exists." });
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase(),
    description,
    discountType,
    discountValue,
    minOrderValue: minOrderValue || 0,
    maxDiscountAmount: maxDiscountAmount || undefined,
    usageLimit: usageLimit || null,
    perUserLimit: perUserLimit || 1,
    expiresAt,
  });

  res.status(201).json({ success: true, coupon });
});

// @desc    Update a coupon
// @route   PATCH /api/coupons/:id
// @access  Private/Admin
export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found." });

  const allowedFields = [
    "description",
    "discountType",
    "discountValue",
    "minOrderValue",
    "maxDiscountAmount",
    "usageLimit",
    "perUserLimit",
    "expiresAt",
    "isActive",
  ];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) coupon[field] = req.body[field];
  });

  await coupon.save();
  res.status(200).json({ success: true, coupon });
});

// @desc    Delete a coupon
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found." });
  await coupon.deleteOne();
  res.status(200).json({ success: true, message: "Coupon deleted." });
});
