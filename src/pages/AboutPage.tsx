import React from 'react';
import StaffPublicShell from '../components/StaffPublicShell';
import {
  StaffPublicBulletList,
  StaffPublicProse,
  StaffPublicSection,
} from '../components/staffPublicContent';

const AboutPage: React.FC = () => (
  <StaffPublicShell
    activeNav="about"
    title="About Rainmaker Queen 2.0"
    subtitle="Lead management built for law firms and legal professionals."
  >
    <div className="space-y-4">
      <StaffPublicSection title="Our mission">
        <StaffPublicProse>
          Rainmaker Queen 2.0 is a lead management platform designed for law firms. We help legal
          teams transform lead generation, client management, and business development through
          intelligent automation and data-driven insights.
        </StaffPublicProse>
        <StaffPublicProse>
          Our platform combines advanced AI with intuitive design so legal professionals can focus on
          serving clients and growing their practice.
        </StaffPublicProse>
      </StaffPublicSection>

      <StaffPublicSection title="What we do">
        <StaffPublicBulletList
          items={[
            'Intelligent lead capture and qualification',
            'Automated client communication workflows',
            'Advanced analytics and reporting',
            'Seamless integration with existing systems',
          ]}
        />
      </StaffPublicSection>

      <StaffPublicSection title="Why choose us">
        <StaffPublicBulletList
          items={[
            'Built specifically for legal professionals',
            'Industry-leading security and compliance',
            'Dedicated customer support',
            'Continuous innovation and updates',
          ]}
        />
      </StaffPublicSection>

      <StaffPublicSection title="Our story">
        <StaffPublicProse>
          Founded by legal professionals who experienced firsthand the challenges of managing leads
          and client relationships, Rainmaker Queen 2.0 was born from a simple idea: legal teams
          deserve better tools to manage their business.
        </StaffPublicProse>
        <StaffPublicProse>
          Today we serve law firms across the country, helping them streamline operations, improve
          client satisfaction, and grow more efficiently.
        </StaffPublicProse>
      </StaffPublicSection>
    </div>
  </StaffPublicShell>
);

export default AboutPage;
