import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';

const ClientDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClient = async () => {
      if (!id) return;

      try {
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        setClient(data);
      } catch (error) {
        console.error('Error fetching client:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchClient();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-2xl font-bold mb-4">Client Not Found</h2>
        <p className="text-base-content/70">The requested client could not be found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      {/* Client Header */}
      <div className="bg-base-100 shadow-lg p-6 mb-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold mb-2">{client.name}</h1>
              <div className="flex items-center gap-4 text-base-content/70">
                <span className="badge badge-primary">{client.lead_number}</span>
                {client.email && <span>{client.email}</span>}
                {client.phone && <span>{client.phone}</span>}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={`badge ${
                client.status === 'new' ? 'badge-success' :
                client.status === 'in_progress' ? 'badge-warning' :
                client.status === 'qualified' ? 'badge-info' :
                'badge-error'
              }`}>
                {client.status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Client Details */}
      <div className="max-w-7xl mx-auto bg-base-100 rounded-lg shadow-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic Information */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Basic Information</h2>
            <div className="space-y-3">
              {client.source && (
                <div>
                  <span className="font-medium">Source:</span> {client.source}
                </div>
              )}
              {client.language && (
                <div>
                  <span className="font-medium">Language:</span> {client.language}
                </div>
              )}
              {client.topic && (
                <div>
                  <span className="font-medium">Topic:</span> {client.topic}
                </div>
              )}
            </div>
          </div>

          {/* Additional Information */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Additional Information</h2>
            {client.facts && (
              <div className="mb-4">
                <h3 className="font-medium mb-2">Facts of Case:</h3>
                <p className="whitespace-pre-line bg-base-200 p-3 rounded-lg">
                  {client.facts}
                </p>
              </div>
            )}
            {client.special_notes && (
              <div>
                <h3 className="font-medium mb-2">Special Notes:</h3>
                <p className="whitespace-pre-line bg-base-200 p-3 rounded-lg">
                  {client.special_notes}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientDetails; 