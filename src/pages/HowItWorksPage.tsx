import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, UserGroupIcon, ChartBarIcon, CogIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

const HowItWorksPage: React.FC = () => {
  const [visibleElements, setVisibleElements] = useState<Set<string>>(new Set());
  const elementRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleElements(prev => new Set(prev).add(entry.target.id));
          }
        });
      },
      { threshold: 0.1 }
    );

    Object.values(elementRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  const steps = [
    {
      number: '01',
      title: 'Lead Capture',
      description: 'Automatically capture leads from your website, social media, and other channels. Our AI instantly qualifies and categorizes each lead.',
      icon: UserGroupIcon,
      features: ['Website form integration', 'Social media monitoring', 'AI-powered qualification', 'Automatic categorization']
    },
    {
      number: '02',
      title: 'Smart Management',
      description: 'Organize and track your leads with intelligent workflows. Set up automated follow-ups and reminders to never miss an opportunity.',
      icon: CogIcon,
      features: ['Intelligent lead scoring', 'Automated follow-ups', 'Custom workflows', 'Smart reminders']
    },
    {
      number: '03',
      title: 'Client Communication',
      description: 'Streamline client communication with integrated messaging, email templates, and automated responses that maintain personal touch.',
      icon: ChartBarIcon,
      features: ['Integrated messaging', 'Email templates', 'Automated responses', 'Communication tracking']
    },
    {
      number: '04',
      title: 'Analytics & Growth',
      description: 'Track your performance with detailed analytics and insights. Identify trends, optimize your processes, and grow your practice.',
      icon: ShieldCheckIcon,
      features: ['Performance analytics', 'Conversion tracking', 'ROI measurement', 'Growth insights']
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 via-purple-700 to-purple-800 shadow-lg">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <Link to="/login" className="inline-flex items-center text-white hover:text-purple-200 transition-colors duration-200 mb-6">
            <ArrowLeftIcon className="w-5 h-5 mr-2" />
            Back to Login
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 19h20M2 7l5.586 5.586a2 2 0 0 0 2.828 0L12 11l1.586 1.586a2 2 0 0 0 2.828 0L22 7l-3 12H5L2 7z"/>
              <circle cx="4" cy="4" r="2" fill="currentColor"/>
              <circle cx="12" cy="4" r="2" fill="currentColor"/>
              <circle cx="20" cy="4" r="2" fill="currentColor"/>
            </svg>
            <h1 className="text-3xl font-bold text-white">How It Works</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Introduction */}
        <div 
          id="introduction"
          ref={(el) => elementRefs.current['introduction'] = el}
          className={`text-center mb-16 transition-all duration-700 transform ${
            visibleElements.has('introduction') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <h2 className="text-4xl font-bold text-gray-800 mb-6">
            Transform Your Legal Practice in 4 Simple Steps
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Rainmaker Queen 2.0 streamlines your entire lead management process, from initial contact 
            to client conversion. Here's how our platform works to help you grow your practice.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-16">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="flex flex-col items-center">
                {/* Content */}
                <div className="w-full max-w-2xl">
                  <div 
                    id={`step-${step.number}`}
                    ref={(el) => elementRefs.current[`step-${step.number}`] = el}
                    className={`bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
                      visibleElements.has(`step-${step.number}`) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                    }`}
                  >
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-purple-700 rounded-2xl flex items-center justify-center">
                        <span className="text-2xl font-bold text-white">{step.number}</span>
                      </div>
                      <h3 className="text-2xl font-bold text-gray-800">{step.title}</h3>
                    </div>
                    
                    <p className="text-lg text-gray-600 leading-relaxed mb-6">
                      {step.description}
                    </p>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {step.features.map((feature, featureIndex) => (
                        <div key={featureIndex} className="flex items-center gap-3">
                          <div className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0"></div>
                          <span className="text-gray-700">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>


              </div>
            );
          })}
        </div>

        {/* Benefits Section */}
        <div className="mt-20">
          <div 
            id="benefits-header"
            ref={(el) => elementRefs.current['benefits-header'] = el}
            className={`text-center mb-12 transition-all duration-700 transform ${
              visibleElements.has('benefits-header') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            <h2 className="text-3xl font-bold text-gray-800 mb-4">
              Why Legal Professionals Choose Rainmaker Queen 2.0
            </h2>
            <p className="text-lg text-gray-600">
              Join hundreds of law firms that have transformed their practice with our platform
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div 
              id="benefit-1"
              ref={(el) => elementRefs.current['benefit-1'] = el}
              className={`bg-white rounded-2xl shadow-xl p-8 text-center hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
                visibleElements.has('benefit-1') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
            >
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <UserGroupIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Increase Lead Conversion</h3>
              <p className="text-gray-600">
                Our AI-powered qualification and automated follow-ups help convert more leads into clients.
              </p>
            </div>

            <div 
              id="benefit-2"
              ref={(el) => elementRefs.current['benefit-2'] = el}
              className={`bg-white rounded-2xl shadow-xl p-8 text-center hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
                visibleElements.has('benefit-2') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
            >
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <CogIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Save Time & Resources</h3>
              <p className="text-gray-600">
                Automate repetitive tasks and focus on what matters most - serving your clients.
              </p>
            </div>

            <div 
              id="benefit-3"
              ref={(el) => elementRefs.current['benefit-3'] = el}
              className={`bg-white rounded-2xl shadow-xl p-8 text-center hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
                visibleElements.has('benefit-3') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
            >
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <ChartBarIcon className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Grow Your Practice</h3>
              <p className="text-gray-600">
                Data-driven insights help you optimize your processes and scale your business.
              </p>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div 
          id="cta-section"
          ref={(el) => elementRefs.current['cta-section'] = el}
          className={`mt-20 text-center transition-all duration-700 transform ${
            visibleElements.has('cta-section') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-3xl p-12 text-white hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 transform">
            <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
            <p className="text-xl mb-8 opacity-90">
              Join the hundreds of law firms already using Rainmaker Queen 2.0 to grow their practice.
            </p>
            <Link
              to="/contact"
              className="inline-block bg-white text-purple-600 font-semibold px-8 py-4 rounded-xl hover:bg-gray-100 transition-colors duration-200"
            >
              Schedule a Demo
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HowItWorksPage; 