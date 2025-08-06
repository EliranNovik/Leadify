import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useMsal } from '@azure/msal-react';

const sources = [
  '',
  'Website',
  'Referral',
  'Phone',
  'Email',
  'Social Media',
  'Other',
];

const languages = [
  '',
  'English',
  'Hebrew',
  'German',
  'French',
  'Russian',
  'Other',
];

interface NewLeadResult {
  id: string; // This will be a UUID string
  lead_number: string;
  name: string;
  email: string;
}

const CreateNewLead: React.FC = () => {
  const navigate = useNavigate();
  const { instance } = useMsal();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    source: '',
    language: '',
    topic: '',
    facts: '',
    specialNotes: '',
    balance_currency: 'NIS',
    proposal_currency: 'NIS',
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      // Get current user from MSAL
      const account = instance?.getAllAccounts()[0];
      if (account?.username) {
        setCurrentUserEmail(account.username);
      } else {
        // Fallback to Supabase auth if MSAL is not available
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserEmail(user?.email || null);
      }
    };
    fetchUser();
  }, [instance]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Call the new database function to create the lead
      const { data, error } = await supabase.rpc('create_new_lead_v3', {
        p_lead_name: form.name,
        p_lead_email: form.email,
        p_lead_phone: form.phone,
        p_lead_topic: form.topic,
        p_lead_language: form.language,
        p_lead_source: form.source,
        p_created_by: currentUserEmail,
        p_balance_currency: form.balance_currency,
        p_proposal_currency: form.proposal_currency,
      });

      if (error) throw error;
      const newLead = data?.[0] as NewLeadResult;
      if (!newLead) throw new Error("Could not create lead.");

      // Navigate to the new lead's page
      navigate(`/clients/${newLead.lead_number}`);
    } catch (error) {
      console.error('Error creating lead:', error);
      alert('Failed to create lead. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Create New Lead</h1>
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div>
          <label className="block font-semibold mb-1">Name:</label>
          <input
            type="text"
            name="name"
            className="input input-bordered w-full"
            value={form.name}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Email:</label>
          <input
            type="email"
            name="email"
            className="input input-bordered w-full"
            value={form.email}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Phone:</label>
          <input
            type="tel"
            name="phone"
            className="input input-bordered w-full"
            value={form.phone}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Source:</label>
          <select
            name="source"
            className="select select-bordered w-full"
            value={form.source}
            onChange={handleChange}
            required
          >
            <option value="">----------</option>
            {sources.slice(1).map((src) => (
              <option key={src} value={src}>{src}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Language:</label>
          <select
            name="language"
            className="select select-bordered w-full"
            value={form.language}
            onChange={handleChange}
            required
          >
            <option value="">----------</option>
            {languages.slice(1).map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Topic:</label>
          <input
            type="text"
            name="topic"
            className="input input-bordered w-full"
            value={form.topic}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Facts of Case:</label>
          <textarea
            name="facts"
            className="textarea textarea-bordered w-full min-h-[120px]"
            value={form.facts}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Special notes:</label>
          <textarea
            name="specialNotes"
            className="textarea textarea-bordered w-full min-h-[80px]"
            value={form.specialNotes}
            onChange={handleChange}
          />
        </div>
        <div className="pt-4">
          <button 
            type="submit" 
            className={`btn btn-primary w-full text-lg font-semibold ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateNewLead; 