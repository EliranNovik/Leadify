import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import RecruitmentMeetingForm from '../components/meeting/RecruitmentMeetingForm';
import {
  buildRecruitmentCandidatePath,
  candidateDisplayName,
} from '../lib/recruitmentCandidates';
import { fetchRecruitmentUserById } from '../lib/recruitmentDigitalContracts';
import {
  fetchRecruitmentMeetings,
  type RecruitmentMeeting,
} from '../lib/recruitmentMeetings';

const RecruitmentRescheduleMeetingPage: React.FC = () => {
  const { userId: rawUserId, meetingId: rawMeetingId } = useParams<{
    userId: string;
    meetingId: string;
  }>();
  const userId = rawUserId ? decodeURIComponent(rawUserId) : '';
  const meetingId = Number(rawMeetingId);
  const navigate = useNavigate();
  const [name, setName] = useState('Candidate');
  const [meeting, setMeeting] = useState<RecruitmentMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !Number.isFinite(meetingId)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [user, meetings] = await Promise.all([
          fetchRecruitmentUserById(userId),
          fetchRecruitmentMeetings(userId),
        ]);
        if (cancelled) return;
        if (user) setName(candidateDisplayName(user));
        const found = meetings.find((m) => m.id === meetingId) || null;
        if (!found) setError('Meeting not found');
        setMeeting(found);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Failed to load meeting');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, meetingId]);

  const back = () => navigate(buildRecruitmentCandidatePath(userId));

  if (!userId || !Number.isFinite(meetingId)) {
    return <div className="p-8 text-center text-gray-500">Missing meeting.</div>;
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] px-4 py-6 lg:pl-8">
      <button
        type="button"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        onClick={back}
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to candidate
      </button>
      {loading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-md text-emerald-600" />
        </div>
      ) : error || !meeting ? (
        <div className="rounded-2xl bg-white p-8 text-center text-gray-500 shadow-sm">
          {error || 'Meeting not found'}
        </div>
      ) : (
        <RecruitmentMeetingForm
          userId={userId}
          candidateName={name}
          mode="reschedule"
          meeting={meeting}
          onComplete={back}
          onCancel={back}
        />
      )}
    </div>
  );
};

export default RecruitmentRescheduleMeetingPage;
