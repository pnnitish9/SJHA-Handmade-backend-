import jwt from "jsonwebtoken";

// Sign a JWT containing the user's id and role
export const signToken = (userId, role) => {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

// Attach the token as an HTTP-only cookie AND return it in the response body.
// The cookie handles desktop browsers; the token in the body lets the frontend
// store it in localStorage as a fallback for mobile browsers (Safari ITP,
// Android WebViews) that block cross-origin cookies even with SameSite=None.
export const sendTokenResponse = (user, statusCode, res) => {
  const token = signToken(user._id, user.role);

  const cookieExpiresDays = Number(process.env.JWT_COOKIE_EXPIRES_DAYS) || 7;

  const cookieOptions = {
    expires: new Date(Date.now() + cookieExpiresDays * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  };

  res
    .status(statusCode)
    .cookie("token", token, cookieOptions)
    .json({
      success: true,
      token, // consumed by the frontend axios interceptor for mobile fallback
      user: user.toSafeObject ? user.toSafeObject() : user,
    });
};
