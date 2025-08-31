import React, { useState, useEffect } from 'react';
import { 
  CloudIcon, 
  CheckCircleIcon, 
  ExclamationTriangleIcon, 
  XCircleIcon,
  ArrowPathIcon,
  PlusIcon,
  TrashIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { 
  createGraphSubscription, 
  listGraphSubscriptions, 
  renewGraphSubscription, 
  deleteGraphSubscription, 
  getSubscriptionStatus, 
  autoRenewSubscription,
  formatSubscriptionStatus,
  GraphSubscription,
  SubscriptionResponse
} from '../../lib/graphSubscriptionApi';

const GraphSubscriptionManager: React.FC = () => {
  const [subscription, setSubscription] = useState<GraphSubscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Load subscription status on component mount
  useEffect(() => {
    loadSubscriptionStatus();
  }, []);

  const loadSubscriptionStatus = async () => {
    setStatusLoading(true);
    try {
      const response = await getSubscriptionStatus();
      if (response.success && response.subscription) {
        setSubscription(response.subscription);
      } else {
        setSubscription(null);
      }
      setLastChecked(new Date());
    } catch (error) {
      console.error('Error loading subscription status:', error);
      toast.error('Failed to load subscription status');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleCreateSubscription = async () => {
    setLoading(true);
    try {
      const response = await createGraphSubscription();
      if (response.success && response.subscription) {
        setSubscription(response.subscription);
        toast.success('Subscription created successfully');
      } else {
        toast.error(response.error || 'Failed to create subscription');
      }
    } catch (error) {
      console.error('Error creating subscription:', error);
      toast.error('Failed to create subscription');
    } finally {
      setLoading(false);
    }
  };

  const handleRenewSubscription = async () => {
    setLoading(true);
    try {
      const response = await renewGraphSubscription();
      if (response.success && response.subscription) {
        setSubscription(response.subscription);
        toast.success('Subscription renewed successfully');
      } else {
        toast.error(response.error || 'Failed to renew subscription');
      }
    } catch (error) {
      console.error('Error renewing subscription:', error);
      toast.error('Failed to renew subscription');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubscription = async () => {
    if (!confirm('Are you sure you want to delete the subscription? This will stop automatic transcript processing.')) {
      return;
    }

    setLoading(true);
    try {
      const response = await deleteGraphSubscription();
      if (response.success) {
        setSubscription(null);
        toast.success('Subscription deleted successfully');
      } else {
        toast.error(response.error || 'Failed to delete subscription');
      }
    } catch (error) {
      console.error('Error deleting subscription:', error);
      toast.error('Failed to delete subscription');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoRenew = async () => {
    setLoading(true);
    try {
      const response = await autoRenewSubscription();
      if (response.success && response.subscription) {
        setSubscription(response.subscription);
        toast.success(response.message || 'Subscription managed successfully');
      } else {
        toast.error(response.error || 'Failed to manage subscription');
      }
    } catch (error) {
      console.error('Error auto-renewing subscription:', error);
      toast.error('Failed to manage subscription');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = () => {
    if (!subscription) return <XCircleIcon className="w-6 h-6 text-red-500" />;
    
    const status = formatSubscriptionStatus(subscription);
    switch (status.status) {
      case 'active':
        return <CheckCircleIcon className="w-6 h-6 text-green-500" />;
      case 'expiring':
        return <ExclamationTriangleIcon className="w-6 h-6 text-yellow-500" />;
      case 'expired':
        return <XCircleIcon className="w-6 h-6 text-red-500" />;
      default:
        return <ClockIcon className="w-6 h-6 text-gray-500" />;
    }
  };

  const getStatusText = () => {
    if (!subscription) return 'No subscription found';
    
    const status = formatSubscriptionStatus(subscription);
    return status.message;
  };

  const getStatusColor = () => {
    if (!subscription) return 'text-gray-500';
    
    const status = formatSubscriptionStatus(subscription);
    switch (status.status) {
      case 'active':
        return 'text-green-600';
      case 'expiring':
        return 'text-yellow-600';
      case 'expired':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <CloudIcon className="w-8 h-8 text-blue-600" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Graph API Subscription Manager</h2>
          <p className="text-sm text-gray-600">Manage Microsoft Graph API subscriptions for automatic transcript processing</p>
        </div>
      </div>

      {/* Status Card */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <h3 className="font-semibold text-gray-900">Subscription Status</h3>
              <p className={`text-sm ${getStatusColor()}`}>{getStatusText()}</p>
            </div>
          </div>
          <button
            onClick={loadSubscriptionStatus}
            disabled={statusLoading}
            className="btn btn-ghost btn-sm"
          >
            <ArrowPathIcon className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        
        {lastChecked && (
          <p className="text-xs text-gray-500 mt-2">
            Last checked: {lastChecked.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Subscription Details */}
      {subscription && (
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <h4 className="font-semibold text-blue-900 mb-3">Subscription Details</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium text-gray-700">ID:</span>
              <span className="ml-2 text-gray-900 font-mono">{subscription.id}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Resource:</span>
              <span className="ml-2 text-gray-900">{subscription.resource}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Change Type:</span>
              <span className="ml-2 text-gray-900">{subscription.changeType}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Expires:</span>
              <span className="ml-2 text-gray-900">
                {new Date(subscription.expirationDateTime).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Notification URL:</span>
              <span className="ml-2 text-gray-900 text-xs break-all">{subscription.notificationUrl}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Client State:</span>
              <span className="ml-2 text-gray-900 font-mono text-xs">{subscription.clientState}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        {!subscription ? (
          <button
            onClick={handleCreateSubscription}
            disabled={loading}
            className="btn btn-primary"
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            {loading ? 'Creating...' : 'Create Subscription'}
          </button>
        ) : (
          <>
            <button
              onClick={handleRenewSubscription}
              disabled={loading}
              className="btn btn-secondary"
            >
              <ArrowPathIcon className="w-4 h-4 mr-2" />
              {loading ? 'Renewing...' : 'Renew Subscription'}
            </button>
            
            <button
              onClick={handleAutoRenew}
              disabled={loading}
              className="btn btn-accent"
            >
              <CheckCircleIcon className="w-4 h-4 mr-2" />
              {loading ? 'Processing...' : 'Auto-Renew'}
            </button>
            
            <button
              onClick={handleDeleteSubscription}
              disabled={loading}
              className="btn btn-error"
            >
              <TrashIcon className="w-4 h-4 mr-2" />
              {loading ? 'Deleting...' : 'Delete Subscription'}
            </button>
          </>
        )}
      </div>

      {/* Information Panel */}
      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h4 className="font-semibold text-yellow-800 mb-2">Important Information</h4>
        <ul className="text-sm text-yellow-700 space-y-1">
          <li>• Graph API subscriptions expire after 45-50 minutes and must be renewed</li>
          <li>• The webhook endpoint must be publicly accessible</li>
          <li>• Ensure your Azure AD app has the required permissions</li>
          <li>• Monitor subscription status regularly to ensure continuous operation</li>
          <li>• Use "Auto-Renew" to automatically manage subscription lifecycle</li>
        </ul>
      </div>
    </div>
  );
};

export default GraphSubscriptionManager;
