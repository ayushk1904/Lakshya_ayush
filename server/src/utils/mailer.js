const nodemailer = require("nodemailer");

function createTransport() {
  const user = process.env.SMTP_GMAIL_USER;
  const pass = process.env.SMTP_GMAIL_APP_PASSWORD;
  const allowSelfSigned = process.env.SMTP_ALLOW_SELF_SIGNED === "true";

  if (!user || !pass) {
    throw new Error("SMTP_GMAIL_USER and SMTP_GMAIL_APP_PASSWORD must be set to send OTP emails");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: !allowSelfSigned
    }
  });
}

async function sendOtpEmail({ to, name, otp }) {
  const from = process.env.MAIL_FROM || process.env.SMTP_GMAIL_USER;
  const transport = createTransport();

  try {
    await transport.sendMail({
      from,
      to,
      subject: "Lakshya password reset OTP",
      text: `Hello ${name || "Student"}, your Lakshya OTP is ${otp}. It expires in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2430;">
          <h2>Lakshya password reset</h2>
          <p>Hello ${name || "Student"},</p>
          <p>Use this OTP to reset your password:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${otp}</p>
          <p>This code expires in 10 minutes.</p>
        </div>
      `
    });
  } catch (error) {
    if (error && error.code === "ESOCKET" && /self-signed certificate/i.test(error.message || "")) {
      throw new Error(
        "Email send failed because of a local certificate check. Set SMTP_ALLOW_SELF_SIGNED=true in server/.env and restart the server."
      );
    }

    if (error && error.code === "EAUTH") {
      throw new Error("Gmail rejected the sender login. Check SMTP_GMAIL_USER and SMTP_GMAIL_APP_PASSWORD.");
    }

    throw error;
  }
}

module.exports = {
  sendOtpEmail
};
