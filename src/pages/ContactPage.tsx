import React, { useState } from 'react';
import { EnvelopeIcon, MapPinIcon, PhoneIcon } from '@heroicons/react/24/outline';
import StaffPublicShell, {
  STAFF_PUBLIC_INPUT_CLASS,
  STAFF_PUBLIC_LABEL_CLASS,
  STAFF_PUBLIC_TEXTAREA_CLASS,
} from '../components/StaffPublicShell';
import {
  StaffPublicContactList,
  StaffPublicContactRow,
  StaffPublicProse,
  StaffPublicSection,
} from '../components/staffPublicContent';

const ContactPage: React.FC = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    setTimeout(() => {
      setSubmitStatus('success');
      setIsSubmitting(false);
      setFormData({ name: '', email: '', company: '', message: '' });
    }, 2000);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <StaffPublicShell
      activeNav="contact"
      title="Contact us"
      subtitle="Reach out for a demo, pricing, or support."
    >
      <div className="space-y-4">
        <StaffPublicSection title="Get in touch">
          <StaffPublicProse>
            Ready to transform your legal practice? Contact us for a personalized demo or to learn
            how Rainmaker Queen 2.0 can help your firm grow.
          </StaffPublicProse>

          <StaffPublicContactList>
            <StaffPublicContactRow
              icon={EnvelopeIcon}
              label="Email"
              lines={['hello@rainmakerqueen.com']}
              hint="We typically respond within 24 hours"
            />
            <StaffPublicContactRow
              icon={PhoneIcon}
              label="Phone"
              lines={['+1 (555) 123-4567']}
              hint="Monday – Friday, 9 AM – 6 PM EST"
            />
            <StaffPublicContactRow
              icon={MapPinIcon}
              label="Office"
              lines={['123 Legal Tech Avenue', 'New York, NY 10001']}
            />
          </StaffPublicContactList>
        </StaffPublicSection>

        <StaffPublicSection title="Send a message">
          {submitStatus === 'success' ? (
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 p-4 text-sm text-emerald-800">
              Thank you! Your message has been sent. We&apos;ll get back to you soon.
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className={STAFF_PUBLIC_LABEL_CLASS} htmlFor="name">
                Full name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className={STAFF_PUBLIC_INPUT_CLASS}
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className={STAFF_PUBLIC_LABEL_CLASS} htmlFor="email">
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                className={STAFF_PUBLIC_INPUT_CLASS}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className={STAFF_PUBLIC_LABEL_CLASS} htmlFor="company">
                Law firm / company
              </label>
              <input
                type="text"
                id="company"
                name="company"
                value={formData.company}
                onChange={handleChange}
                className={STAFF_PUBLIC_INPUT_CLASS}
                placeholder="Enter your firm or company name"
              />
            </div>

            <div>
              <label className={STAFF_PUBLIC_LABEL_CLASS} htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                rows={5}
                className={STAFF_PUBLIC_TEXTAREA_CLASS}
                placeholder="Tell us how we can help you..."
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary h-11 w-full rounded-xl border-0 font-semibold"
            >
              {isSubmitting ? <span className="loading loading-spinner loading-sm" /> : 'Send message'}
            </button>
          </form>
        </StaffPublicSection>
      </div>
    </StaffPublicShell>
  );
};

export default ContactPage;
