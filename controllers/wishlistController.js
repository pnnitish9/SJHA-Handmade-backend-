import Wishlist from "../models/Wishlist.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorHandler.js";

// @desc    Get the logged-in user's wishlist
// @route   GET /api/wishlist
// @access  Private
export const getWishlist = asyncHandler(async (req, res) => {
  let wishlist = await Wishlist.findOne({ user: req.user._id }).populate({
    path: "products.product",
    select: "name slug images price discountPrice isAvailable stock",
  });

  if (!wishlist) {
    wishlist = await Wishlist.create({ user: req.user._id, products: [] });
  }

  res.status(200).json({ success: true, wishlist });
});

// @desc    Add a product to the wishlist
// @route   POST /api/wishlist/:productId
// @access  Private
export const addToWishlist = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found." });
  }

  let wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) wishlist = new Wishlist({ user: req.user._id, products: [] });

  const alreadyIn = wishlist.products.some((p) => p.product.toString() === req.params.productId);
  if (!alreadyIn) {
    wishlist.products.push({ product: req.params.productId });
    await wishlist.save();
  }

  await wishlist.populate({
    path: "products.product",
    select: "name slug images price discountPrice isAvailable stock",
  });

  res.status(200).json({ success: true, wishlist });
});

// @desc    Remove a product from the wishlist
// @route   DELETE /api/wishlist/:productId
// @access  Private
export const removeFromWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) return res.status(404).json({ success: false, message: "Wishlist not found." });

  wishlist.products = wishlist.products.filter(
    (p) => p.product.toString() !== req.params.productId
  );
  await wishlist.save();
  await wishlist.populate({
    path: "products.product",
    select: "name slug images price discountPrice isAvailable stock",
  });

  res.status(200).json({ success: true, wishlist });
});
