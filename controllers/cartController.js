import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorHandler.js";

// Resolves available stock for a product, accounting for a variant if given
function resolveStock(product, variantId) {
  if (variantId) {
    const variant = product.variants.id(variantId);
    return variant ? variant.stock : 0;
  }
  return product.stock;
}

function resolvePrice(product, variantId) {
  if (variantId) {
    const variant = product.variants.id(variantId);
    return variant?.price ?? product.discountPrice ?? product.price;
  }
  return product.discountPrice ?? product.price;
}

// @desc    Get the logged-in user's cart, with product details populated
// @route   GET /api/cart
// @access  Private
export const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id }).populate({
    path: "items.product",
    select: "name slug images price discountPrice stock variants isAvailable",
  });

  if (!cart) {
    cart = await Cart.create({ user: req.user._id, items: [] });
  }

  res.status(200).json({ success: true, cart });
});

// @desc    Add an item to the cart (or increase quantity if it's already there)
// @route   POST /api/cart/items
// @access  Private
export const addCartItem = asyncHandler(async (req, res) => {
  const { productId, variantId, quantity = 1 } = req.body;

  const product = await Product.findById(productId);
  if (!product || !product.isAvailable) {
    return res.status(404).json({ success: false, message: "Product not found or unavailable." });
  }

  const availableStock = resolveStock(product, variantId);
  if (availableStock < quantity) {
    return res.status(400).json({ success: false, message: `Only ${availableStock} left in stock.` });
  }

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = new Cart({ user: req.user._id, items: [] });

  const existingItem = cart.items.find(
    (item) =>
      item.product.toString() === productId &&
      (item.variantId?.toString() || null) === (variantId || null)
  );

  if (existingItem) {
    const newQty = existingItem.quantity + Number(quantity);
    if (newQty > availableStock) {
      return res.status(400).json({ success: false, message: `Only ${availableStock} left in stock.` });
    }
    existingItem.quantity = newQty;
  } else {
    cart.items.push({
      product: productId,
      variantId: variantId || undefined,
      quantity,
      priceAtAdd: resolvePrice(product, variantId),
    });
  }

  await cart.save();
  await cart.populate({
    path: "items.product",
    select: "name slug images price discountPrice stock variants isAvailable",
  });

  res.status(200).json({ success: true, cart });
});

// @desc    Update quantity of a cart item
// @route   PATCH /api/cart/items/:itemId
// @access  Private
export const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) {
    return res.status(400).json({ success: false, message: "Quantity must be at least 1." });
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return res.status(404).json({ success: false, message: "Cart not found." });

  const item = cart.items.id(req.params.itemId);
  if (!item) return res.status(404).json({ success: false, message: "Cart item not found." });

  const product = await Product.findById(item.product);
  const availableStock = resolveStock(product, item.variantId);
  if (quantity > availableStock) {
    return res.status(400).json({ success: false, message: `Only ${availableStock} left in stock.` });
  }

  item.quantity = quantity;
  await cart.save();
  await cart.populate({
    path: "items.product",
    select: "name slug images price discountPrice stock variants isAvailable",
  });

  res.status(200).json({ success: true, cart });
});

// @desc    Remove a single item from the cart
// @route   DELETE /api/cart/items/:itemId
// @access  Private
export const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return res.status(404).json({ success: false, message: "Cart not found." });

  cart.items = cart.items.filter((item) => item._id.toString() !== req.params.itemId);
  await cart.save();
  await cart.populate({
    path: "items.product",
    select: "name slug images price discountPrice stock variants isAvailable",
  });

  res.status(200).json({ success: true, cart });
});

// @desc    Clear the entire cart
// @route   DELETE /api/cart
// @access  Private
export const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (cart) {
    cart.items = [];
    await cart.save();
  }
  res.status(200).json({ success: true, cart: cart || { items: [] } });
});
