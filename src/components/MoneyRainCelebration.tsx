import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Confetti from 'react-confetti';
import { useCelebration } from '../contexts/CelebrationContext';
import { XMarkIcon } from '@heroicons/react/24/outline';

const MoneyRainCelebration: React.FC = () => {
  const { isCelebrating, celebrationData, closeCelebration, showCelebration } = useCelebration();
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const [showContent, setShowContent] = useState(false);

  // Listen for custom events to trigger celebration
  useEffect(() => {
    const handleCelebrationEvent = (event: CustomEvent) => {
      const { employeeName, employeeId } = event.detail;
      showCelebration({
        employeeName: employeeName || 'Team Member',
        employeeId: employeeId || null,
      });
    };

    window.addEventListener('celebrate-contract-signed', handleCelebrationEvent as EventListener);
    
    return () => {
      window.removeEventListener('celebrate-contract-signed', handleCelebrationEvent as EventListener);
    };
  }, [showCelebration]);

  useEffect(() => {
    const updateSize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (isCelebrating) {
      // Small delay to trigger animation
      setTimeout(() => setShowContent(true), 100);
    } else {
      setShowContent(false);
    }
  }, [isCelebrating]);

  if (!isCelebrating || !celebrationData) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] pointer-events-none">
      {/* Confetti/Money Rain - Multiple layers for more effect */}
      {showContent && (
        <>
          <Confetti
            width={windowSize.width}
            height={windowSize.height}
            recycle={false}
            numberOfPieces={400}
            gravity={0.3}
            initialVelocityY={20}
            confettiSource={{
              x: windowSize.width / 2,
              y: 0,
              w: windowSize.width,
              h: 0,
            }}
            colors={['#FFD700', '#FFA500', '#FF6347', '#32CD32', '#1E90FF', '#FF1493']}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
            }}
          />
          <Confetti
            width={windowSize.width}
            height={windowSize.height}
            recycle={false}
            numberOfPieces={300}
            gravity={0.4}
            initialVelocityY={25}
            confettiSource={{
              x: windowSize.width / 4,
              y: 0,
              w: windowSize.width / 2,
              h: 0,
            }}
            colors={['#FFD700', '#FFA500', '#FF6347', '#32CD32', '#1E90FF', '#FF1493', '#FF69B4', '#00CED1']}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
            }}
          />
          <Confetti
            width={windowSize.width}
            height={windowSize.height}
            recycle={false}
            numberOfPieces={300}
            gravity={0.35}
            initialVelocityY={22}
            confettiSource={{
              x: windowSize.width * 0.75,
              y: 0,
              w: windowSize.width / 2,
              h: 0,
            }}
            colors={['#FFD700', '#FFA500', '#FF6347', '#32CD32', '#1E90FF', '#FF1493', '#9370DB', '#20B2AA']}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
            }}
          />
        </>
      )}

      {/* Celebration Card */}
      <div
        className={`fixed inset-0 flex items-center justify-center pointer-events-auto transition-opacity duration-700 ${
          showContent ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Backdrop blur */}
        <div 
          className="absolute inset-0 bg-black/20 backdrop-blur-sm"
          onClick={closeCelebration}
        />
        
        <div 
          className={`relative bg-white rounded-3xl shadow-2xl p-8 md:p-12 max-w-2xl w-full mx-4 transform transition-all duration-700 ${
            showContent ? 'scale-100 translate-y-0' : 'scale-95 translate-y-8'
          }`}
          style={{
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 215, 0, 0.1)',
          }}
        >
          {/* Animated gradient border */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-400 opacity-20 blur-xl -z-10 animate-pulse" />
          
          {/* Close Button */}
          <button
            onClick={closeCelebration}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-all duration-200 hover:scale-110 hover:rotate-90 rounded-full p-1 hover:bg-gray-100"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>

          {/* Content */}
          <div className="text-center">
            {/* Money Icon with modern animation */}
            <div className="mb-6 flex justify-center">
              <div 
                className={`text-7xl md:text-9xl transition-all duration-700 ${
                  showContent ? 'scale-100 rotate-0' : 'scale-0 rotate-180'
                }`}
                style={{
                  animation: showContent ? 'float 3s ease-in-out infinite' : 'none',
                  filter: 'drop-shadow(0 10px 20px rgba(255, 215, 0, 0.3))',
                }}
              >
                💰
              </div>
            </div>

            {/* Title with fade-in animation */}
            <h2 
              className={`text-4xl md:text-5xl font-bold bg-gradient-to-r from-yellow-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent mb-6 transition-all duration-700 delay-100 ${
                showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{
                backgroundSize: '200% auto',
                animation: showContent ? 'gradient-shift 3s ease infinite' : 'none',
              }}
            >
              Congratulations!
            </h2>

            {/* Employee Name with slide-in animation */}
            <div 
              className={`mb-6 transition-all duration-700 delay-200 ${
                showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              <div className="inline-block bg-gradient-to-r from-yellow-50 via-yellow-100 to-yellow-50 rounded-2xl px-8 py-4 shadow-lg border border-yellow-200/50">
                <p className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-yellow-600 to-orange-600 bg-clip-text text-transparent">
                  {celebrationData.employeeName || 'Team Member'}
                </p>
              </div>
            </div>

            {/* Message with fade-in animation */}
            <p 
              className={`text-xl md:text-2xl text-gray-700 mb-2 font-medium transition-all duration-700 delay-300 ${
                showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              signed another contract right now!
            </p>

            <p 
              className={`text-base md:text-lg text-gray-500 mt-6 transition-all duration-700 delay-400 ${
                showContent ? 'opacity-100' : 'opacity-0'
              }`}
            >
              Keep up the amazing work!
            </p>
          </div>

          {/* Modern decorative sparkles */}
          <div className="absolute top-8 left-8 w-2 h-2 bg-yellow-400 rounded-full animate-ping" style={{ animationDelay: '0s', animationDuration: '2s' }} />
          <div className="absolute top-12 right-12 w-1.5 h-1.5 bg-orange-400 rounded-full animate-ping" style={{ animationDelay: '0.5s', animationDuration: '2s' }} />
          <div className="absolute bottom-12 left-12 w-1.5 h-1.5 bg-yellow-400 rounded-full animate-ping" style={{ animationDelay: '1s', animationDuration: '2s' }} />
          <div className="absolute bottom-8 right-8 w-2 h-2 bg-orange-400 rounded-full animate-ping" style={{ animationDelay: '1.5s', animationDuration: '2s' }} />
        </div>
      </div>
      
      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px) scale(1);
          }
          50% {
            transform: translateY(-20px) scale(1.05);
          }
        }
        
        @keyframes gradient-shift {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default MoneyRainCelebration;

