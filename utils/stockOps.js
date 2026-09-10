import Product from "../models/Product.js";

// Atomically decrements stock only if enough is available — this is the
// fix for the classic race condition where two concurrent checkouts both
// read stock=1, both pass the "is there enough?" check, and both sell the
// same last unit. A plain read-then-save can never be made safe against
// that; the check and the decrement have to happen as one atomic operation
// at the database level.
//
// Returns the updated product on success, or null if there wasn't enough
// stock left (caller should treat that as "someone else got there first").
export async function reserveStock(productId, variantId, quantity) {
  if (variantId) {
    return Product.findOneAndUpdate(
      { _id: productId, "variants._id": variantId, "variants.stock": { $gte: quantity } },
      { $inc: { "variants.$.stock": -quantity } },
      { new: true }
    );
  }
  return Product.findOneAndUpdate(
    { _id: productId, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
    { new: true }
  );
}

// Releases previously reserved stock — used both for customer/admin
// cancellations and to compensate items already reserved earlier in a
// checkout loop when a later item in the same order fails.
export async function releaseStock(productId, variantId, quantity) {
  if (variantId) {
    return Product.findOneAndUpdate(
      { _id: productId, "variants._id": variantId },
      { $inc: { "variants.$.stock": quantity } },
      { new: true }
    );
  }
  return Product.findOneAndUpdate({ _id: productId }, { $inc: { stock: quantity } }, { new: true });
}
