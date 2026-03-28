import React from 'react';
import Sidebar from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="flex min-h-0 h-[100dvh] max-h-[100dvh] overflow-hidden">
      <Sidebar />
      <main className="flex min-h-0 flex-1 overflow-y-auto bg-base-100 pl-32">
        {children}
      </main>
    </div>
  );
};

export default Layout; 