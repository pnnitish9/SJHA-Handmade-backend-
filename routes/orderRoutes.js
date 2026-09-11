import express from "express";
import {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  retryPayment,
  getAllOrders,
  updateOrderStatus,
} from "../controllers/orderController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";

const router = express.Router();

router.use(protect);

// Customer
router.post("/", createOrder);
router.get("/mine", getMyOrders);
router.patch("/:id/cancel", cancelOrder);
router.get("/:id/retry-payment", retryPayment);

// Admin — declared before the generic "/:id" so they aren't swallowed by it
router.get("/", authorize("admin"), getAllOrders);
router.patch("/:id/status", authorize("admin"), updateOrderStatus);

// Shared (owner or admin — checked inside the controller)
router.get("/:id", getOrder);

export default router;
