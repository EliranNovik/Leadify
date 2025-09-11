import { supabase } from './supabase';

/**
 * Get the current user's email signature from the database
 * @returns Promise<string> - The user's email signature or empty string if not found
 */
export const getCurrentUserEmailSignature = async (): Promise<string> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      console.warn('No authenticated user found');
      return '';
    }

    // Get the user's full_name from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('full_name')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData?.full_name) {
      console.warn('Could not get user full name:', userError);
      return '';
    }

    // Get the employee's email signature
    const { data: employeeData, error } = await supabase
      .from('tenants_employee')
      .select('email_signature')
      .eq('display_name', userData.full_name)
      .single();

    if (error) {
      console.warn('Error fetching email signature:', error);
      return '';
    }

    return employeeData?.email_signature || '';
  } catch (error) {
    console.error('Error getting email signature:', error);
    return '';
  }
};

/**
 * Append the user's email signature to email content
 * @param emailContent - The main email content
 * @returns Promise<string> - Email content with signature appended
 */
export const appendEmailSignature = async (emailContent: string): Promise<string> => {
  const signature = await getCurrentUserEmailSignature();
  
  if (!signature) {
    return emailContent;
  }

  // Check if signature is HTML or plain text
  const isHtml = signature.includes('<') && signature.includes('>');
  
  if (isHtml) {
    // For HTML emails, append HTML signature
    return `${emailContent}<br><br>${signature}`;
  } else {
    // For plain text emails, append plain text signature
    return `${emailContent}\n\n${signature}`;
  }
};

/**
 * Get email signature for a specific user by their display name
 * @param displayName - The user's display name
 * @returns Promise<string> - The user's email signature or empty string if not found
 */
export const getEmailSignatureByDisplayName = async (displayName: string): Promise<string> => {
  try {
    const { data: employeeData, error } = await supabase
      .from('tenants_employee')
      .select('email_signature')
      .eq('display_name', displayName)
      .single();

    if (error) {
      console.warn('Error fetching email signature for user:', displayName, error);
      return '';
    }

    return employeeData?.email_signature || '';
  } catch (error) {
    console.error('Error getting email signature for user:', displayName, error);
    return '';
  }
};
