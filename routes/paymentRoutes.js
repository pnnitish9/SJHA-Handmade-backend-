import express from "express";
import { verifyPayment } from "../controllers/paymentController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.post("/verify", protect, verifyPayment);

export default router;
