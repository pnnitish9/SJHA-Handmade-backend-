import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { notify } from "../utils/notify.js";

// --- shared service (used by both the REST route and the socket handler) ---

// Posts a message into a conversation, updates conversation metadata/unread
// counts, and creates a notification for the other party. Returns the saved
// message (populated with sender name) so callers can broadcast it.
export async function postMessage({ conversationId, senderId, senderRole, text }) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw { statusCode: 404, message: "Conversation not found." };

  const message = await Message.create({
    conversation: conversationId,
    sender: senderId,
    senderRole,
    text,
  });
  await message.populate("sender", "name");

  conversation.lastMessage = text;
  conversation.lastMessageAt = new Date();
  if (senderRole === "customer") {
    conversation.unreadByAdmin += 1;
  } else {
    conversation.unreadByCustomer += 1;
  }
  await conversation.save();

  const notifyUserId = senderRole === "customer" ? conversation.admin : conversation.customer;
  if (notifyUserId) {
    notify({
      user: notifyUserId,
      type: "chat_message",
      title: "New message",
      message: text.length > 80 ? `${text.slice(0, 80)}…` : text,
      link: `/messages/${conversationId}`,
    });
  }

  return { message, conversation };
}

// --- REST controllers ---

// @desc    Get (or create) the customer's open conversation
// @route   POST /api/conversations
// @access  Private (customer)
export const getOrCreateConversation = asyncHandler(async (req, res) => {
  let conversation = await Conversation.findOne({ customer: req.user._id, isClosed: false });
  if (!conversation) {
    conversation = await Conversation.create({
      customer: req.user._id,
      subject: req.body.subject || "General Inquiry",
    });
  }
  res.status(200).json({ success: true, conversation });
});

// @desc    List the logged-in customer's conversations
// @route   GET /api/conversations/mine
// @access  Private (customer)
export const getMyConversations = asyncHandler(async (req, res) => {
  const conversations = await Conversation.find({ customer: req.user._id }).sort("-lastMessageAt");
  res.status(200).json({ success: true, conversations });
});

// @desc    List every conversation — admin inbox
// @route   GET /api/conversations
// @access  Private/Admin
export const getAllConversations = asyncHandler(async (req, res) => {
  const conversations = await Conversation.find()
    .populate("customer", "name email")
    .sort("-lastMessageAt");
  res.status(200).json({ success: true, conversations });
});

// @desc    Get message history for a conversation (participant only)
// @route   GET /api/conversations/:id/messages
// @access  Private
export const getMessages = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });

  const isParticipant =
    conversation.customer.toString() === req.user._id.toString() || req.user.role === "admin";
  if (!isParticipant) return res.status(403).json({ success: false, message: "Not authorized." });

  const messages = await Message.find({ conversation: req.params.id })
    .populate("sender", "name")
    .sort("createdAt");

  res.status(200).json({ success: true, conversation, messages });
});

// @desc    Send a message (REST fallback — the app primarily uses Socket.IO)
// @route   POST /api/conversations/:id/messages
// @access  Private
export const sendMessageRest = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });

  const isParticipant =
    conversation.customer.toString() === req.user._id.toString() || req.user.role === "admin";
  if (!isParticipant) return res.status(403).json({ success: false, message: "Not authorized." });

  const { message } = await postMessage({
    conversationId: req.params.id,
    senderId: req.user._id,
    senderRole: req.user.role,
    text: req.body.text,
  });

  res.status(201).json({ success: true, message });
});

// @desc    Mark a conversation as read for the caller's role
// @route   PATCH /api/conversations/:id/read
// @access  Private
export const markRead = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });

  if (req.user.role === "admin") {
    conversation.unreadByAdmin = 0;
    if (!conversation.admin) conversation.admin = req.user._id;
  } else {
    conversation.unreadByCustomer = 0;
  }
  await conversation.save();

  res.status(200).json({ success: true, conversation });
});
