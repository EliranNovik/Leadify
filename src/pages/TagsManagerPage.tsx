import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import TagsManagerReport, { TagsManagerShellTitle } from '../components/reports/TagsManagerReport';

export default function TagsManagerPage() {
  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <TagsManagerShellTitle />
        <Link to="/reports" className="btn btn-ghost btn-sm self-start sm:self-auto shrink-0">
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Back to Reports
        </Link>
      </div>
      <TagsManagerReport />
    </div>
  );
}
