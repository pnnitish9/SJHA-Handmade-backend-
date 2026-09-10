import jwt from "jsonwebtoken";
import cookie from "cookie";
import User from "../models/User.js";

// Runs once per socket connection attempt. Rejects the connection outright
// if there's no valid session, so every downstream event handler can trust
// socket.user without re-checking auth.
export async function socketAuthMiddleware(socket, next) {
  try {
    const rawCookie = socket.handshake.headers.cookie;
    if (!rawCookie) return next(new Error("Not authenticated."));

    const { token } = cookie.parse(rawCookie);
    if (!token) return next(new Error("Not authenticated."));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) return next(new Error("Not authenticated."));

    socket.user = { id: user._id.toString(), name: user.name, role: user.role };
    next();
  } catch (error) {
    next(new Error("Not authenticated."));
  }
}
