import express from "express";
import {
  register,
  login,
  logout,
  getMe,
  updateMe,
  updatePassword,
  addAddress,
  deleteAddress,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";
import {
  registerValidation,
  loginValidation,
  updatePasswordValidation,
} from "../middleware/validators.js";

const router = express.Router();

// Public
router.post("/register", registerValidation, register);
router.post("/login", loginValidation, login);

// Private (any authenticated role — customer or admin)
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);
router.patch("/me", protect, updateMe);
router.patch("/update-password", protect, updatePasswordValidation, updatePassword);
router.post("/addresses", protect, addAddress);
router.delete("/addresses/:addressId", protect, deleteAddress);

export default router;
