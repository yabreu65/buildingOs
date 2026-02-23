import React from 'react';
import { UnifiedLeadForm } from '@/features/public/components/UnifiedLeadForm';

export const metadata = {
  title: 'Contact Us | BuildingOS',
  description: 'Get started with BuildingOS. Submit your information and our sales team will contact you within 24 hours.',
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">
            Ready to Transform Your Property Management?
          </h1>
          <p className="mt-4 text-lg text-gray-600">
            Join hundreds of property managers using BuildingOS to streamline operations,
            improve resident communication, and increase efficiency.
          </p>
        </div>

        {/* Form */}
        <UnifiedLeadForm
          intent="CONTACT"
          title="Get Started"
          subtitle="Tell us about your property and our team will get back to you within 24 hours."
          successTitle="Thank You!"
          successMessage="We've received your information and will contact you within 24 hours to discuss how BuildingOS can help your property."
        />

        {/* Footer */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-3xl font-bold text-blue-600">24h</div>
            <p className="text-gray-600 mt-2">Response time from our team</p>
          </div>
          <div>
            <div className="text-3xl font-bold text-blue-600">14-day</div>
            <p className="text-gray-600 mt-2">Free trial, no credit card required</p>
          </div>
          <div>
            <div className="text-3xl font-bold text-blue-600">99.9%</div>
            <p className="text-gray-600 mt-2">Uptime SLA guarantee</p>
          </div>
        </div>
      </div>
    </div>
  );
}
