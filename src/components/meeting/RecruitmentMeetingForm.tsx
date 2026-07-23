import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useMsal } from '@azure/msal-react';
import MeetingDurationField, {
  DEFAULT_MEETING_DURATION_MINUTES,
} from './MeetingDurationField';
import MeetingParticipantsPicker from './MeetingParticipantsPicker';
import MicrosoftSignInBox from './MicrosoftSignInBox';
import {
  cancelRecruitmentMeeting,
  createRecruitmentMeeting,
  updateRecruitmentMeeting,
  type RecruitmentMeeting,
} from '../../lib/recruitmentMeetings';
import {
  fetchMeetingParticipants,
  selectionFromLoadedParticipants,
  type FreeMeetingParticipant,
  type MeetingParticipantsSelection,
} from '../../lib/meetingParticipants';
import {
  fetchRecruitmentCandidateContact,
  withRecruitmentCandidateParticipant,
} from '../../lib/recruitmentMeetingParticipants';
import { loginRequest } from '../../msalConfig';

type Props = {
  userId: string;
  candidateName: string;
  mode: 'schedule' | 'reschedule';
  meeting?: RecruitmentMeeting | null;
  onComplete: () => void;
  onCancel: () => void;
};

const emptySelection = (): MeetingParticipantsSelection => ({
  employeeIds: [],
  firmContactIds: [],
  freeParticipants: [],
});

const emptyFree = (): FreeMeetingParticipant => ({
  name: '',
  email: '',
  phone: '',
  notes: '',
});

const RecruitmentMeetingForm: React.FC<Props> = ({
  userId,
  candidateName,
  mode,
  meeting,
  onComplete,
  onCancel,
}) => {
  const { instance, accounts } = useMsal();
  const account = accounts[0] || null;
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(meeting?.date || '');
  const [time, setTime] = useState(meeting?.time?.slice(0, 5) || '10:00');
  const [duration, setDuration] = useState(
    meeting?.duration || DEFAULT_MEETING_DURATION_MINUTES,
  );
  const [location, setLocation] = useState(meeting?.location || 'Teams');
  const [brief, setBrief] = useState(meeting?.brief || '');
  const [participants, setParticipants] = useState<MeetingParticipantsSelection>(emptySelection);
  const [freeDraft, setFreeDraft] = useState<FreeMeetingParticipant>(emptyFree);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [candidateContactReady, setCandidateContactReady] = useState(false);

  useEffect(() => {
    if (meeting) {
      setDate(meeting.date || '');
      setTime(meeting.time?.slice(0, 5) || '10:00');
      setDuration(meeting.duration || DEFAULT_MEETING_DURATION_MINUTES);
      setLocation(meeting.location || 'Teams');
      setBrief(meeting.brief || '');
    }
  }, [meeting]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const contact = await fetchRecruitmentCandidateContact(userId, candidateName);
        if (cancelled) return;
        if (mode === 'schedule' && !meeting?.id) {
          setParticipants((prev) => withRecruitmentCandidateParticipant(prev, contact));
        }
      } catch (err) {
        console.error('Failed to load candidate contact for participants:', err);
      } finally {
        if (!cancelled) setCandidateContactReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, candidateName, mode, meeting?.id]);

  useEffect(() => {
    if (!meeting?.id || mode !== 'reschedule') {
      if (mode !== 'reschedule') {
        setFreeDraft(emptyFree());
      }
      return;
    }
    let cancelled = false;
    setLoadingParticipants(true);
    (async () => {
      try {
        const [rows, contact] = await Promise.all([
          fetchMeetingParticipants(meeting.id),
          fetchRecruitmentCandidateContact(userId, candidateName),
        ]);
        if (cancelled) return;
        const selection = withRecruitmentCandidateParticipant(
          selectionFromLoadedParticipants(rows),
          contact,
        );
        setParticipants(selection);
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error('Failed to load participants');
      } finally {
        if (!cancelled) setLoadingParticipants(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meeting?.id, mode, userId, candidateName]);

  const createTeamsLinkIfPossible = async (): Promise<string | null> => {
    if (location !== 'Teams' || !account) return null;
    try {
      const tokenResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account,
      });
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + duration * 60 * 1000);
      const res = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResponse.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          subject: `Recruitment interview — ${candidateName}`,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.joinWebUrl || data.joinUrl || null;
    } catch (err) {
      console.warn('Teams meeting create skipped:', err);
      return null;
    }
  };

  const handleSave = async () => {
    if (!date || !time) {
      toast.error('Date and time are required');
      return;
    }
    setSaving(true);
    try {
      const teamsUrl = await createTeamsLinkIfPossible();
      if (mode === 'schedule') {
        await createRecruitmentMeeting({
          userId,
          candidateName,
          date,
          time,
          duration,
          location,
          brief,
          teamsMeetingUrl: teamsUrl,
          participants,
          freeDraft,
        });
        toast.success('Interview scheduled');
      } else if (meeting?.id) {
        await updateRecruitmentMeeting(
          meeting.id,
          {
            date,
            time,
            duration,
            location,
            brief: brief.trim() || null,
            teams_meeting_url: teamsUrl || meeting.teams_meeting_url,
            status: 'scheduled',
            subject: meeting.subject || `Job Interview — ${candidateName}`,
          },
          participants,
          freeDraft,
        );
        toast.success('Interview rescheduled');
      }
      onComplete();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to save meeting');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelMeeting = async () => {
    if (!meeting?.id) return;
    setSaving(true);
    try {
      await cancelRecruitmentMeeting(meeting.id);
      toast.success('Interview canceled');
      onComplete();
    } catch (error) {
      console.error(error);
      toast.error('Failed to cancel meeting');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {mode === 'schedule' ? 'Schedule interview' : 'Reschedule interview'}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">{candidateName}</p>
        </div>
        <MicrosoftSignInBox />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Date</span>
          <input
            type="date"
            className="rounded-xl border border-gray-200 px-3 py-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Time</span>
          <input
            type="time"
            className="rounded-xl border border-gray-200 px-3 py-2"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
      </div>

      <MeetingDurationField value={duration} onChange={setDuration} startTime={time} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Location</span>
        <select
          className="rounded-xl border border-gray-200 px-3 py-2"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="Teams">Teams</option>
          <option value="Office">Office</option>
          <option value="Phone">Phone</option>
          <option value="Other">Other</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Brief / notes</span>
        <textarea
          className="min-h-[100px] rounded-xl border border-gray-200 px-3 py-2"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Interview focus, interviewers, prep notes…"
        />
      </label>

      {loadingParticipants || !candidateContactReady ? (
        <div className="flex justify-center py-6">
          <span className="loading loading-spinner loading-md text-emerald-600" />
        </div>
      ) : (
        <MeetingParticipantsPicker
          value={participants}
          onChange={setParticipants}
          freeDraft={freeDraft}
          onFreeDraftChange={setFreeDraft}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost rounded-full" onClick={onCancel} disabled={saving}>
            Back
          </button>
          {mode === 'reschedule' && meeting?.id ? (
            <button
              type="button"
              className="btn btn-ghost rounded-full text-error"
              onClick={() => void handleCancelMeeting()}
              disabled={saving}
            >
              Cancel meeting
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? <span className="loading loading-spinner loading-sm" /> : null}
          {mode === 'schedule' ? 'Schedule' : 'Save reschedule'}
        </button>
      </div>
    </div>
  );
};

export default RecruitmentMeetingForm;
