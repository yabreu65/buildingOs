/**
 * Email Templates
 * Simple, responsive HTML templates for BuildingOS emails
 */

import { TenantBranding } from './email.types';

export class EmailTemplates {
  /**
   * Base email wrapper with branding
   */
  static baseTemplate(
    content: string,
    branding: TenantBranding,
  ): string {
    const brandName = branding.brandName || 'BuildingOS';
    const primaryColor = branding.primaryColor || '#2563eb';
    const logoUrl = branding.logoUrl;
    const supportEmail = branding.supportEmail || 'support@buildingos.example.com';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background-color: ${primaryColor};
      color: white;
      padding: 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .logo {
      max-height: 40px;
      margin-bottom: 12px;
    }
    .content {
      padding: 32px 24px;
    }
    .button {
      display: inline-block;
      background-color: ${primaryColor};
      color: white !important;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      margin: 16px 0;
      cursor: pointer;
    }
    .button:hover {
      opacity: 0.9;
    }
    .footer {
      background-color: #f9f9f9;
      padding: 16px 24px;
      text-align: center;
      font-size: 12px;
      color: #999;
      border-top: 1px solid #eee;
    }
    .footer a {
      color: ${primaryColor};
      text-decoration: none;
    }
    .alert {
      background-color: #fef3cd;
      border-left: 4px solid #ffc107;
      padding: 12px;
      margin: 16px 0;
      border-radius: 4px;
      font-size: 14px;
      color: #856404;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoUrl ? `<img src="${logoUrl}" alt="${brandName}" class="logo">` : ''}
      <h1>${brandName}</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} ${brandName}. All rights reserved.</p>
      <p><a href="mailto:${supportEmail}">${supportEmail}</a></p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Team Invitation Email
   */
  static invitationEmail(
    data: {
      invitedEmail: string;
      tenantName: string;
      inviteUrl: string;
      expiresAt: string;
      inviterName?: string;
    },
    branding: TenantBranding,
  ): { subject: string; html: string } {
    const content = `
<h2>You've been invited!</h2>
<p>Hi <strong>${data.invitedEmail}</strong>,</p>
<p>${data.inviterName ? `<strong>${data.inviterName}</strong> has` : 'You have been'} invited to join <strong>${data.tenantName}</strong> on ${branding.brandName || 'BuildingOS'}.</p>

<div style="margin: 24px 0; text-align: center;">
  <a href="${data.inviteUrl}" class="button">Accept Invitation</a>
</div>

<p>Or copy this link in your browser:</p>
<p style="background-color: #f5f5f5; padding: 12px; border-radius: 4px; word-break: break-all; font-size: 12px;">
  ${data.inviteUrl}
</p>

<div class="alert">
  <strong>Important:</strong> This invitation expires on ${data.expiresAt}.
</div>

<p>If you didn't expect this invitation or have any questions, please contact the team at ${branding.supportEmail || 'support@buildingos.example.com'}.</p>
    `;

    return {
      subject: `Invitation to join ${data.tenantName}`,
      html: this.baseTemplate(content, branding),
    };
  }

  /**
   * Password Reset Email (Optional)
   */
  static passwordResetEmail(
    data: {
      email: string;
      resetUrl: string;
      expiresInHours: number;
    },
    branding: TenantBranding,
  ): { subject: string; html: string } {
    const content = `
<h2>Reset Your Password</h2>
<p>Hi ${data.email},</p>
<p>We received a request to reset your password. Click the button below to create a new password.</p>

<div style="margin: 24px 0; text-align: center;">
  <a href="${data.resetUrl}" class="button">Reset Password</a>
</div>

<p>Or copy this link:</p>
<p style="background-color: #f5f5f5; padding: 12px; border-radius: 4px; word-break: break-all; font-size: 12px;">
  ${data.resetUrl}
</p>

<div class="alert">
  <strong>Security:</strong> This link expires in ${data.expiresInHours} hours. If you didn't request this, please ignore this email.
</div>

<p>If you have trouble resetting your password, contact support at ${branding.supportEmail || 'support@buildingos.example.com'}.</p>
    `;

    return {
      subject: 'Reset Your Password',
      html: this.baseTemplate(content, branding),
    };
  }

  /**
   * Payment Submitted Notification (Optional)
   */
  static paymentSubmittedEmail(
    data: {
      tenantName: string;
      unitCode: string;
      amount: number;
      currency: string;
      submittedAt: string;
      status: string;
    },
    branding: TenantBranding,
  ): { subject: string; html: string } {
    const amountFormatted = (data.amount / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: data.currency || 'USD',
    });

    const content = `
<h2>Payment Submitted</h2>
<p>A payment has been submitted for ${data.tenantName}.</p>

<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
  <tr style="background-color: #f5f5f5;">
    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Unit</strong></td>
    <td style="padding: 8px; border: 1px solid #ddd;">${data.unitCode}</td>
  </tr>
  <tr>
    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount</strong></td>
    <td style="padding: 8px; border: 1px solid #ddd;">${amountFormatted}</td>
  </tr>
  <tr style="background-color: #f5f5f5;">
    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Status</strong></td>
    <td style="padding: 8px; border: 1px solid #ddd;">${data.status}</td>
  </tr>
  <tr>
    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td>
    <td style="padding: 8px; border: 1px solid #ddd;">${data.submittedAt}</td>
  </tr>
</table>

<p>Please review and approve this payment in your ${branding.brandName || 'BuildingOS'} account.</p>
    `;

    return {
      subject: `Payment Submitted - ${data.unitCode}`,
      html: this.baseTemplate(content, branding),
    };
  }
}
