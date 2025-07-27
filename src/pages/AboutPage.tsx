import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

const AboutPage: React.FC = () => {
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
            <h1 className="text-3xl font-bold text-white">About Rainmaker Queen 2.0</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div 
          id="mission"
          ref={(el) => elementRefs.current['mission'] = el}
          className={`bg-white rounded-2xl shadow-xl p-8 mb-8 hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
            visibleElements.has('mission') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Our Mission</h2>
          <p className="text-lg text-gray-600 leading-relaxed mb-6">
            Rainmaker Queen 2.0 is a cutting-edge lead management platform designed specifically for law firms and legal professionals. 
            We empower legal teams to transform their lead generation, client management, and business development processes through 
            intelligent automation and data-driven insights.
          </p>
          <p className="text-lg text-gray-600 leading-relaxed">
            Our platform combines advanced AI technology with intuitive design to help legal professionals focus on what matters most - 
            serving their clients and growing their practice.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-8">
          <div 
            id="what-we-do"
            ref={(el) => elementRefs.current['what-we-do'] = el}
            className={`bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
              visibleElements.has('what-we-do') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            <h3 className="text-xl font-bold text-gray-800 mb-4">What We Do</h3>
            <ul className="space-y-3 text-gray-600">
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>Intelligent lead capture and qualification</span>
              </li>
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>Automated client communication workflows</span>
              </li>
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>Advanced analytics and reporting</span>
              </li>
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>Seamless integration with existing systems</span>
              </li>
            </ul>
          </div>

          <div 
            id="why-choose-us"
            ref={(el) => elementRefs.current['why-choose-us'] = el}
            className={`bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
              visibleElements.has('why-choose-us') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            <h3 className="text-xl font-bold text-gray-800 mb-4">Why Choose Us</h3>
            <ul className="space-y-3 text-gray-600">
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>Built specifically for legal professionals</span>
              </li>
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>Industry-leading security and compliance</span>
              </li>
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>24/7 customer support</span>
              </li>
              <li className="flex items-start">
                <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span>Continuous innovation and updates</span>
              </li>
            </ul>
          </div>
        </div>

        <div 
          id="our-story"
          ref={(el) => elementRefs.current['our-story'] = el}
          className={`bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl hover:-translate-y-1 transition-all duration-700 transform ${
            visibleElements.has('our-story') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Our Story</h2>
          <p className="text-lg text-gray-600 leading-relaxed mb-6">
            Founded by legal professionals who experienced firsthand the challenges of managing leads and client relationships, 
            Rainmaker Queen 2.0 was born from a simple idea: legal professionals deserve better tools to manage their business.
          </p>
          <p className="text-lg text-gray-600 leading-relaxed">
            Today, we serve hundreds of law firms across the country, helping them streamline their operations, 
            improve client satisfaction, and grow their practices more efficiently than ever before.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AboutPage; 