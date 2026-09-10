import Notification from "../models/Notification.js";

// Creates an in-app notification record. Never throws — a failed notification
// write should never block the order/chat action that triggered it.
export const notify = async ({ user, type, title, message, link }) => {
  try {
    await Notification.create({ user, type, title, message, link });
  } catch (error) {
    console.error(`Failed to create notification: ${error.message}`);
  }
};
