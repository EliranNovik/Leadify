import React from 'react';
import { Link } from 'react-router-dom';
import StaffPublicShell from '../components/StaffPublicShell';
import {
  StaffPublicBulletList,
  StaffPublicCtaBox,
  StaffPublicProse,
  StaffPublicSection,
} from '../components/staffPublicContent';

const steps = [
  {
    number: '01',
    title: 'Lead capture',
    description:
      'Automatically capture leads from your website, social media, and other channels. Our AI instantly qualifies and categorizes each lead.',
    features: [
      'Website form integration',
      'Social media monitoring',
      'AI-powered qualification',
      'Automatic categorization',
    ],
  },
  {
    number: '02',
    title: 'Smart management',
    description:
      'Organize and track your leads with intelligent workflows. Set up automated follow-ups and reminders to never miss an opportunity.',
    features: [
      'Intelligent lead scoring',
      'Automated follow-ups',
      'Custom workflows',
      'Smart reminders',
    ],
  },
  {
    number: '03',
    title: 'Client communication',
    description:
      'Streamline client communication with integrated messaging, email templates, and automated responses that maintain a personal touch.',
    features: [
      'Integrated messaging',
      'Email templates',
      'Automated responses',
      'Communication tracking',
    ],
  },
  {
    number: '04',
    title: 'Analytics & growth',
    description:
      'Track your performance with detailed analytics and insights. Identify trends, optimize your processes, and grow your practice.',
    features: [
      'Performance analytics',
      'Conversion tracking',
      'ROI measurement',
      'Growth insights',
    ],
  },
];

const HowItWorksPage: React.FC = () => (
  <StaffPublicShell
    activeNav="how-it-works"
    title="How it works"
    subtitle="Transform your legal practice in four simple steps."
  >
    <div className="space-y-4">
      <StaffPublicSection title="Overview">
        <StaffPublicProse>
          Rainmaker Queen 2.0 streamlines your entire lead management process, from initial contact
          to client conversion. Here is how our platform helps you grow your practice.
        </StaffPublicProse>
      </StaffPublicSection>

      {steps.map((step) => (
        <StaffPublicSection key={step.number} title={`Step ${step.number} · ${step.title}`}>
          <StaffPublicProse>{step.description}</StaffPublicProse>
          <StaffPublicBulletList items={step.features} />
        </StaffPublicSection>
      ))}

      <StaffPublicSection title="Increase lead conversion">
        <StaffPublicProse>
          Our AI-powered qualification and automated follow-ups help convert more leads into clients.
        </StaffPublicProse>
      </StaffPublicSection>

      <StaffPublicSection title="Save time & resources">
        <StaffPublicProse>
          Automate repetitive tasks and focus on what matters most — serving your clients.
        </StaffPublicProse>
      </StaffPublicSection>

      <StaffPublicSection title="Grow your practice">
        <StaffPublicProse>
          Data-driven insights help you optimize your processes and scale your business.
        </StaffPublicProse>
      </StaffPublicSection>

      <StaffPublicCtaBox
        title="Ready to get started?"
        action={
          <Link
            to="/contact"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-white px-8 font-semibold text-primary transition-colors hover:bg-neutral-100 md:w-auto"
          >
            Schedule a demo
          </Link>
        }
      >
        Join the law firms already using Rainmaker Queen 2.0 to grow their practice.
      </StaffPublicCtaBox>
    </div>
  </StaffPublicShell>
);

export default HowItWorksPage;
