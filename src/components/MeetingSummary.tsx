import React, { useState, useEffect } from 'react';
import { 
  DocumentTextIcon, 
  ClockIcon, 
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  EnvelopeIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  UserIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';
import { 
  getMeetingData, 
  regenerateMeetingSummary, 
  sendMeetingSummaryEmail,
  triggerMeetingSummaryProcessing,
  MeetingSummary,
  MeetingTranscript,
  MeetingQuestionnaire 
} from '../lib/meetingSummaryApi';
import toast from 'react-hot-toast';

interface MeetingSummaryProps {
  meetingId: string | number;
  clientId: string;
  clientEmail?: string;
  onUpdate?: () => void;
}

const MeetingSummaryComponent: React.FC<MeetingSummaryProps> = ({
  meetingId,
  clientId,
  clientEmail,
  onUpdate
}) => {
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [transcript, setTranscript] = useState<MeetingTranscript | null>(null);
  const [questionnaire, setQuestionnaire] = useState<MeetingQuestionnaire | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<'he' | 'en'>('en');

  useEffect(() => {
    loadMeetingData();
  }, [meetingId]);

  const loadMeetingData = async () => {
    setLoading(true);
    try {
      const data = await getMeetingData(meetingId);
      setSummary(data.summary);
      setTranscript(data.transcript);
      setQuestionnaire(data.questionnaire);
      
      // Set default language based on detected language
      if (data.summary?.language_detected === 'he') {
        setSelectedLanguage('he');
      }
    } catch (error) {
      console.error('Error loading meeting data:', error);
      toast.error('Failed to load meeting summary');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateSummary = async () => {
    setRegenerating(true);
    try {
      const result = await regenerateMeetingSummary(meetingId);
      if (result.success) {
        toast.success('Meeting summary regenerated successfully');
        await loadMeetingData();
        if (onUpdate) onUpdate();
      } else {
        toast.error(result.error || 'Failed to regenerate summary');
      }
    } catch (error) {
      console.error('Error regenerating summary:', error);
      toast.error('Failed to regenerate summary');
    } finally {
      setRegenerating(false);
    }
  };

  const handleProcessMeeting = async () => {
    setProcessing(true);
    try {
      console.log('🔧 Processing meeting:', meetingId);
      const result = await triggerMeetingSummaryProcessing(meetingId, clientId, {
        autoFetchTranscript: true
      });
      
      if (result.success) {
        toast.success('Meeting processed successfully! Refreshing data...');
        await loadMeetingData();
        if (onUpdate) onUpdate();
      } else {
        toast.error(result.error || 'Failed to process meeting');
      }
    } catch (error) {
      console.error('Error processing meeting:', error);
      toast.error('Failed to process meeting');
    } finally {
      setProcessing(false);
    }
  };

  const handleSendEmail = async () => {
    if (!summary || !clientEmail) {
      toast.error('No summary or client email available');
      return;
    }

    setSendingEmail(true);
    try {
      const summaryText = selectedLanguage === 'he' ? summary.summary_he : summary.summary_en;
      const success = await sendMeetingSummaryEmail(clientId, meetingId, summaryText, selectedLanguage);
      
      if (success) {
        toast.success('Meeting summary sent to client');
        if (onUpdate) onUpdate();
      } else {
        toast.error('Failed to send meeting summary');
      }
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Failed to send meeting summary');
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-center py-8">
          <div className="loading loading-spinner loading-lg text-purple-600"></div>
          <span className="ml-3 text-gray-600">Loading meeting summary...</span>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-6">
        <div className="text-center py-8">
          <DocumentTextIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No meeting summary available</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Summary will appear here once processed</p>
          
          {/* Process Meeting Button */}
          <button
            onClick={handleProcessMeeting}
            disabled={processing}
            className="btn btn-primary btn-sm"
          >
            {processing ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <DocumentTextIcon className="w-4 h-4" />
                Process Meeting
              </>
            )}
          </button>
          
          <p className="text-xs text-gray-400 mt-2">
            This will fetch the transcript and generate a summary
          </p>
        </div>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
              <DocumentTextIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Meeting Summary</h3>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ClockIcon className="w-4 h-4" />
                <span>Generated {formatDate(summary.created_at)}</span>
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                  Auto
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRegenerateSummary}
              disabled={regenerating}
              className="btn btn-sm btn-outline border-purple-300 text-purple-600 hover:bg-purple-50"
            >
                              {regenerating ? (
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowPathIcon className="w-4 h-4" />
                )}
              Regenerate
            </button>
            {clientEmail && (
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail}
                className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white border-none"
              >
                {sendingEmail ? (
                  <div className="loading loading-spinner loading-xs"></div>
                ) : (
                  <EnvelopeIcon className="w-4 h-4" />
                )}
                Send to Client
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Language Toggle */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">Language:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedLanguage('he')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                selectedLanguage === 'he'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              עברית
            </button>
            <button
              onClick={() => setSelectedLanguage('en')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                selectedLanguage === 'en'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              English
            </button>
          </div>
        </div>
      </div>

      {/* Summary Content */}
      <div className="p-6">
        <div className="space-y-6">
          {/* Summary Text */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 mb-3">
              Summary ({selectedLanguage === 'he' ? 'עברית' : 'English'})
            </h4>
            <div className="text-gray-800 leading-relaxed whitespace-pre-wrap">
              {selectedLanguage === 'he' ? summary.summary_he : summary.summary_en}
            </div>
          </div>

          {/* Action Items */}
          {summary.action_items && summary.action_items.length > 0 && (
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <CheckCircleIcon className="w-5 h-5" />
                Action Items
              </h4>
              <div className="space-y-2">
                {summary.action_items.map((item, index) => (
                  <div key={index} className="bg-white rounded-lg p-3 border border-blue-200">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{item.task}</p>
                        {item.owner && (
                          <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
                            <UserIcon className="w-4 h-4" />
                            {item.owner}
                          </p>
                        )}
                      </div>
                      {item.due_date && (
                        <div className="text-sm text-gray-500 flex items-center gap-1">
                          <CalendarIcon className="w-4 h-4" />
                          {new Date(item.due_date).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risks */}
          {summary.risks && summary.risks.length > 0 && (
            <div className="bg-red-50 rounded-lg p-4">
              <h4 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                <ExclamationTriangleIcon className="w-5 h-5" />
                Risks & Concerns
              </h4>
              <div className="space-y-2">
                {summary.risks.map((risk, index) => (
                  <div key={index} className="bg-white rounded-lg p-3 border border-red-200">
                    <p className="text-gray-900">{risk}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible Sections */}
          <div className="space-y-4">
            {/* Transcript */}
            {transcript && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left"
                >
                  <span className="font-medium text-gray-900">Raw Transcript</span>
                  {showTranscript ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                  )}
                </button>
                {showTranscript && (
                  <div className="p-4 bg-gray-50">
                    <div className="bg-white rounded-lg p-4 max-h-64 overflow-y-auto">
                      <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono">
                        {transcript.text}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Genealogical & Persecution Data */}
            {questionnaire && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowQuestionnaire(!showQuestionnaire)}
                  className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left"
                >
                  <span className="font-medium text-gray-900">Genealogical & Persecution Data</span>
                  {showQuestionnaire ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                  )}
                </button>
                {showQuestionnaire && (
                  <div className="p-4 bg-gray-50 space-y-4">
                    {/* Persecuted Person */}
                    {questionnaire.payload.persecuted_person && (
                      <div className="bg-blue-50 rounded-lg p-4">
                        <h6 className="font-semibold text-blue-800 mb-3">Persecuted Person</h6>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                          <div><strong>Name:</strong> {questionnaire.payload.persecuted_person.full_name || 'Not specified'}</div>
                          <div><strong>Birth:</strong> {questionnaire.payload.persecuted_person.birth_date || 'Not specified'} in {questionnaire.payload.persecuted_person.birth_place || 'Not specified'}</div>
                          <div><strong>Country:</strong> {questionnaire.payload.persecuted_person.country_of_origin || 'Not specified'}</div>
                          <div><strong>Persecution:</strong> {questionnaire.payload.persecuted_person.persecution_type || 'Not specified'}</div>
                          <div><strong>Entry Germany:</strong> {questionnaire.payload.persecuted_person.entry_germany_date || 'Not specified'}</div>
                          <div><strong>Entry Austria:</strong> {questionnaire.payload.persecuted_person.entry_austria_date || 'Not specified'}</div>
                          <div><strong>Left Germany:</strong> {questionnaire.payload.persecuted_person.left_germany_date || 'Not specified'}</div>
                          <div><strong>Left Austria:</strong> {questionnaire.payload.persecuted_person.left_austria_date || 'Not specified'}</div>
                          <div><strong>Emigrated to:</strong> {questionnaire.payload.persecuted_person.emigration_destination || 'Not specified'}</div>
                          <div><strong>Emigration date:</strong> {questionnaire.payload.persecuted_person.emigration_date || 'Not specified'}</div>
                        </div>
                      </div>
                    )}

                    {/* Family Members */}
                    {questionnaire.payload.family_members && (
                      <div className="bg-green-50 rounded-lg p-4">
                        <h6 className="font-semibold text-green-800 mb-3">Family Members</h6>
                        {questionnaire.payload.family_members.parents && questionnaire.payload.family_members.parents.length > 0 && (
                          <div className="mb-3">
                            <strong className="text-sm">Parents:</strong>
                            <ul className="text-sm ml-4 mt-1">
                              {questionnaire.payload.family_members.parents.map((parent: any, idx: number) => (
                                <li key={idx}>• {parent.name || 'Unknown'} - {parent.birth_date || 'Unknown date'} in {parent.birth_place || 'Unknown place'}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {questionnaire.payload.family_members.grandparents && questionnaire.payload.family_members.grandparents.length > 0 && (
                          <div className="mb-3">
                            <strong className="text-sm">Grandparents:</strong>
                            <ul className="text-sm ml-4 mt-1">
                              {questionnaire.payload.family_members.grandparents.map((grandparent: any, idx: number) => (
                                <li key={idx}>• {grandparent.name || 'Unknown'} - {grandparent.birth_date || 'Unknown date'} in {grandparent.birth_place || 'Unknown place'}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {questionnaire.payload.family_members.great_grandparents && questionnaire.payload.family_members.great_grandparents.length > 0 && (
                          <div>
                            <strong className="text-sm">Great Grandparents:</strong>
                            <ul className="text-sm ml-4 mt-1">
                              {questionnaire.payload.family_members.great_grandparents.map((greatGrandparent: any, idx: number) => (
                                <li key={idx}>• {greatGrandparent.name || 'Unknown'} - {greatGrandparent.birth_date || 'Unknown date'} in {greatGrandparent.birth_place || 'Unknown place'}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Documents Mentioned */}
                    {questionnaire.payload.documents_mentioned && questionnaire.payload.documents_mentioned.length > 0 && (
                      <div className="bg-yellow-50 rounded-lg p-4">
                        <h6 className="font-semibold text-yellow-800 mb-2">Documents Mentioned</h6>
                        <ul className="text-sm">
                          {questionnaire.payload.documents_mentioned.map((doc: string, idx: number) => (
                            <li key={idx}>• {doc}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Persecution Details */}
                    {questionnaire.payload.persecution_details && (
                      <div className="bg-red-50 rounded-lg p-4">
                        <h6 className="font-semibold text-red-800 mb-2">Persecution Details</h6>
                        {questionnaire.payload.persecution_details.specific_events && questionnaire.payload.persecution_details.specific_events.length > 0 && (
                          <div className="mb-3">
                            <strong className="text-sm">Events:</strong>
                            <ul className="text-sm ml-4 mt-1">
                              {questionnaire.payload.persecution_details.specific_events.map((event: string, idx: number) => (
                                <li key={idx}>• {event}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {questionnaire.payload.persecution_details.locations && questionnaire.payload.persecution_details.locations.length > 0 && (
                          <div>
                            <strong className="text-sm">Locations:</strong>
                            <ul className="text-sm ml-4 mt-1">
                              {questionnaire.payload.persecution_details.locations.map((location: string, idx: number) => (
                                <li key={idx}>• {location}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Raw JSON for debugging */}
                    <details className="bg-gray-100 rounded-lg p-3">
                      <summary className="cursor-pointer text-sm font-medium text-gray-600">Raw JSON Data</summary>
                      <pre className="whitespace-pre-wrap text-xs text-gray-700 overflow-x-auto mt-2 max-h-32 overflow-y-auto">
                        {JSON.stringify(questionnaire.payload, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Technical Details */}
          <div className="text-xs text-gray-500 border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between">
              <span>Model: {summary.model}</span>
              <span>Tokens: {summary.tokens_used}</span>
              <span>Language: {summary.language_detected}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingSummaryComponent;
