import express from "express";
import {
  getOrCreateConversation,
  getMyConversations,
  getAllConversations,
  getMessages,
  sendMessageRest,
  markRead,
} from "../controllers/conversationController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";

const router = express.Router();

router.use(protect);

router.post("/", getOrCreateConversation);
router.get("/mine", getMyConversations);
router.get("/", authorize("admin"), getAllConversations);

router.get("/:id/messages", getMessages);
router.post("/:id/messages", sendMessageRest);
router.patch("/:id/read", markRead);

export default router;
