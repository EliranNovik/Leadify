import React from 'react';

/** Shared login / clock-in gate hero video + overlays (see `.login-page-media` in index.css). */
const LoginHeroBackground: React.FC = () => (
  <>
    <video
      className="login-page-media absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
    >
      <source src="/login-hero.mp4" type="video/mp4" />
    </video>
    <div className="login-page-media absolute inset-0 w-full h-full bg-gradient-to-b from-[rgba(10,10,10,0.38)] to-[rgba(10,10,10,0.58)] z-0 pointer-events-none" />
    <div className="login-page-media absolute inset-0 w-full h-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_60%)] z-0 pointer-events-none" />
  </>
);

export default LoginHeroBackground;
