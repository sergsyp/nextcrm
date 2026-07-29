import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";

interface EmailOptions {
  from: string | undefined;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export default async function sendEmail(
  emailOptions: EmailOptions
): Promise<void> {
  const password = process.env.EMAIL_PASSWORD_FILE
    ? readFileSync(process.env.EMAIL_PASSWORD_FILE, "utf8").trim()
    : process.env.EMAIL_PASSWORD;

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: password,
    },
  });

  try {
    await transporter.sendMail(emailOptions);
    console.log(`Email sent to ${emailOptions.to}`);
    return Promise.resolve(console.log(`Email sent to ${emailOptions.to}`));
  } catch (error: any | Error) {
    console.error(`Error occurred while sending email: ${error.message}`);
    throw error;
  }
}
