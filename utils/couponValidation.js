import Coupon from "../models/Coupon.js";
import Order from "../models/Order.js";

// Throws an object { statusCode, message } on any failure so callers can
// respond consistently. Returns { coupon, discount } on success.
export async function validateCouponForUser(code, userId, cartSubtotal) {
  if (!code) throw { statusCode: 400, message: "No coupon code provided." };

  const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
  if (!coupon) throw { statusCode: 404, message: "Coupon not found or inactive." };

  if (coupon.expiresAt < new Date()) {
    throw { statusCode: 400, message: "This coupon has expired." };
  }

  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw { statusCode: 400, message: "This coupon has reached its usage limit." };
  }

  if (cartSubtotal < coupon.minOrderValue) {
    throw {
      statusCode: 400,
      message: `This coupon requires a minimum order of ₹${coupon.minOrderValue}.`,
    };
  }

  if (coupon.perUserLimit) {
    const userUsageCount = await Order.countDocuments({
      user: userId,
      coupon: coupon._id,
      status: { $ne: "cancelled" },
    });
    if (userUsageCount >= coupon.perUserLimit) {
      throw { statusCode: 400, message: "You've already used this coupon the maximum number of times." };
    }
  }

  let discount =
    coupon.discountType === "percentage"
      ? (cartSubtotal * coupon.discountValue) / 100
      : coupon.discountValue;

  if (coupon.maxDiscountAmount) {
    discount = Math.min(discount, coupon.maxDiscountAmount);
  }
  discount = Math.min(discount, cartSubtotal); // never discount more than the order is worth

  return { coupon, discount: Math.round(discount) };
}
