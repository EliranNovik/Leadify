import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
import { generateJSON } from '@tiptap/html';
import { CheckIcon, ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, PrinterIcon, ArrowDownTrayIcon, XMarkIcon, Cog6ToothIcon, ShareIcon, PencilIcon, CalendarIcon, ClipboardDocumentIcon, TrashIcon, PhoneIcon, EnvelopeIcon, UserIcon, TagIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { handleContractSigned } from '../lib/contractAutomation';
import { getPricePerApplicant } from '../lib/contractPricing';
import SignaturePad from 'react-signature-canvas';
import { v4 as uuidv4 } from 'uuid';
// Import Heroicons for plus/minus
import { PlusIcon, MinusIcon } from '@heroicons/react/24/solid';
// @ts-ignore - html2pdf.js doesn't have TypeScript definitions
import html2pdf from 'html2pdf.js';
import { getFrontendBaseUrl } from '../lib/api';
import ContractDetailsAndPricingModal from './ContractDetailsAndPricingModal';
import CallOptionsModal from './CallOptionsModal';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';

function fillAllPlaceholders(text: string, customPricing: any, client: any, contract?: any) {
  if (!text) return text;
  let result = text;
  if (customPricing) {
    result = result.replace(/{{applicant_count}}/g, customPricing.applicant_count?.toString() || '');
    result = result.replace(/{{total_amount}}/g, customPricing.total_amount?.toLocaleString() || '');
    result = result.replace(/{{final_amount}}/g, customPricing.final_amount?.toLocaleString() || '');

    // Handle discount placeholders - only show if there's an actual discount
    const discountPercentage = Number(customPricing.discount_percentage) || 0;
    const discountAmount = Number(customPricing.discount_amount) || 0;

    if (discountPercentage > 0 && discountAmount > 0) {
      // Only replace discount placeholders if there's an actual discount
      result = result.replace(/{{discount_percentage}}/g, discountPercentage.toString());
      result = result.replace(/{{discount_amount}}/g, discountAmount.toLocaleString());
    } else {
      // Remove lines that contain discount information when there's no discount
      result = result.replace(/.*discount.*total.*%.*/gi, ''); // Remove lines mentioning discount
      result = result.replace(/.*The client receives a discount.*/gi, ''); // Remove specific discount text
      result = result.replace(/.*{{discount_percentage}}.*/g, ''); // Remove lines with discount percentage placeholder
      result = result.replace(/.*{{discount_amount}}.*/g, ''); // Remove lines with discount amount placeholder
    }

    result = result.replace(/{{currency}}/g, customPricing.currency || '');

    // Handle payment plan placeholders
    if (customPricing.payment_plan && Array.isArray(customPricing.payment_plan)) {
      customPricing.payment_plan.forEach((row: any, index: number) => {
        const placeholder = `{{payment_${index + 1}_percent}}`;
        const valuePlaceholder = `{{payment_${index + 1}_value}}`;
        const duePlaceholder = `{{payment_${index + 1}_due}}`;

        // Handle the new value format "value + VAT" or just "value"
        let displayValue = '0';
        if (row.value) {
          if (typeof row.value === 'string' && row.value.includes('+')) {
            // Parse "value + VAT" format
            const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
            const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
            displayValue = totalValue.toLocaleString();
          } else {
            // Handle numeric value or simple string
            const numValue = parseFloat(row.value) || 0;
            displayValue = numValue.toLocaleString();
          }
        }

        result = result.replace(new RegExp(placeholder, 'g'), row.percent?.toString() || '0');
        result = result.replace(new RegExp(valuePlaceholder, 'g'), `${customPricing.currency} ${displayValue}`);
        result = result.replace(new RegExp(duePlaceholder, 'g'), row.payment_order || row.label || '');
      });
    }

    // Handle payment plan row placeholders
    if (result && result.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
      // Handle specific payment plan row placeholders like {{payment_1_row}}, {{payment_2_row}}, etc.
      customPricing.payment_plan.forEach((row: any, index: number) => {
        const specificPlaceholder = `{{payment_${index + 1}_row}}`;
        if (result.includes(specificPlaceholder)) {
          // Handle the new value format "value + VAT" or just "value"
          let displayValue = '0';
          if (row.value) {
            if (typeof row.value === 'string' && row.value.includes('+')) {
              // Parse "value + VAT" format
              const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
              const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
              displayValue = totalValue.toLocaleString();
            } else {
              // Handle numeric value or simple string
              const numValue = parseFloat(row.value) || 0;
              displayValue = numValue.toLocaleString();
            }
          }
          result = result.replace(new RegExp(specificPlaceholder, 'g'), `${row.percent}% = ${customPricing.currency} ${displayValue}`);
        }
      });

      // Also handle generic {{payment_plan_row}} placeholders (sequential replacement)
      let rowIndex = 0;
      result = result.replace(/\{\{payment_plan_row\}\}/g, (match: string) => {
        const row = customPricing.payment_plan[rowIndex];
        rowIndex++;
        if (row) {
          // Use the exact same value format as shown in the payment plan panel
          let displayValue = '0';
          if (row.value) {
            if (typeof row.value === 'string' && row.value.includes('+')) {
              // Keep the "value + VAT" format exactly as it appears in the panel
              displayValue = row.value;
            } else {
              // Handle numeric value or simple string
              const numValue = parseFloat(row.value) || 0;
              displayValue = numValue.toString();
            }
          }
          return `${row.percent}% = ${customPricing.currency} ${displayValue}`;
        }
        return '';
      });
    }

    // Handle pricing tiers
    if (customPricing.pricing_tiers) {
      const currency = customPricing.currency || 'USD';

      // Get all available tiers in order
      const tierOrder = ['1', '2', '3', '4-7', '8-9', '10-15', '16+'];
      const availableTiers = tierOrder.filter(key =>
        customPricing.pricing_tiers[key] !== undefined &&
        customPricing.pricing_tiers[key] !== null &&
        customPricing.pricing_tiers[key] !== 0
      );

      let currentTierIndex = 0;

      // Handle {{price_per_applicant}} placeholders with sequential fallback
      while (result.includes('{{price_per_applicant}}')) {
        const placeholderIndex = result.indexOf('{{price_per_applicant}}');
        const contextBefore = result.substring(Math.max(0, placeholderIndex - 200), placeholderIndex);

        let tierKey: string | null = null;
        const recentContext = contextBefore.substring(Math.max(0, contextBefore.length - 80));

        // Check for tier patterns - support both English and Hebrew
        if (/16\s*\+\s*applicant|16\s+or\s+more\s+applicant/i.test(recentContext) ||
          /16\+?\s*מבקש|מעל\s*16|מ-?16\s*ומעלה/i.test(recentContext)) {
          tierKey = '16+';
        } else if (/10\s*[-–]\s*15\s+applicant/i.test(recentContext) ||
          /10\s*[-–]\s*15\s*מבקש/i.test(recentContext)) {
          tierKey = '10-15';
        } else if (/8\s*[-–]\s*9\s+applicant/i.test(recentContext) ||
          /8\s*[-–]\s*9\s*מבקש/i.test(recentContext)) {
          tierKey = '8-9';
        } else if (/4\s*[-–]\s*7\s+applicant/i.test(recentContext) ||
          /4\s*[-–]\s*7\s*מבקש/i.test(recentContext)) {
          tierKey = '4-7';
        } else if (/\b3\s+applicant/i.test(recentContext) ||
          /\b3\s*מבקש/i.test(recentContext)) {
          tierKey = '3';
        } else if (/\b2\s+applicant/i.test(recentContext) ||
          /\b2\s*מבקש|שני\s*מבקש/i.test(recentContext)) {
          tierKey = '2';
        } else if (/\b1\s+applicant|one\s+applicant/i.test(recentContext) ||
          /\b1\s*מבקש|מבקש\s*אחד|לכל\s*מבקש/i.test(recentContext)) {
          tierKey = '1';
        }

        // Sequential fallback if no match
        if (!tierKey && currentTierIndex < availableTiers.length) {
          tierKey = availableTiers[currentTierIndex];
          currentTierIndex++;
        }

        if (tierKey && customPricing.pricing_tiers[tierKey] !== undefined) {
          result = result.replace('{{price_per_applicant}}', `${currency} ${(customPricing.pricing_tiers[tierKey] || 0).toLocaleString()}`);
        } else {
          result = result.replace('{{price_per_applicant}}', `${currency} 0`);
        }
      }

      // Also handle specific tier placeholders like {{price_1}}, {{price_2}}, etc.
      tierOrder.forEach(tierKey => {
        if (customPricing.pricing_tiers[tierKey] !== undefined) {
          const placeholder = `{{price_${tierKey}}}`;
          result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `${currency} ${(customPricing.pricing_tiers[tierKey] || 0).toLocaleString()}`);
        }
      });
    }
  }

  // Use contact information if available, otherwise fall back to client
  if (contract && contract.contact_name) {
    result = result.replace(/{{client_name}}/g, contract.contact_name || '');
    result = result.replace(/{{client_phone}}/g, contract.contact_phone || contract.contact_mobile || '');
    result = result.replace(/{{client_email}}/g, contract.contact_email || '');
  } else if (client) {
    result = result.replace(/{{client_name}}/g, client.name || '');
    result = result.replace(/{{client_phone}}/g, client.phone || client.mobile || '');
    result = result.replace(/{{client_email}}/g, client.email || '');
  }

  // Don't replace {{date}} or {{date:ID}} - let renderTiptapContent handle them as date pickers
  // They will only be replaced with formatted text after the contract is signed
  return result;
}

// Function to fill placeholders in TipTap content structure (preserves {{text}} and {{signature}})
function fillPlaceholdersInTiptapContent(content: any, customPricing: any, client: any, contract?: any, editing?: boolean, globalRowIndex?: { current: number }): any {
  if (!content) return content;

  if (Array.isArray(content)) {
    const processedArray = content.map(item => fillPlaceholdersInTiptapContent(item, customPricing, client, contract, editing, globalRowIndex));
    // Filter out undefined values and empty text nodes
    return processedArray.filter(item => {
      if (item === undefined || item === null) return false;
      if (item.type === 'text') {
        return item.text && item.text.trim() !== '';
      }
      return true;
    });
  }

  if (content.type === 'text' && content.text) {
    // Fill all placeholders except {{text}} and {{signature}} (preserve those for interactive elements)
    let text = content.text;

    // Apply all the same placeholder replacements as fillAllPlaceholders but skip {{text}} and {{signature}}
    if (customPricing) {
      text = text.replace(/{{applicant_count}}/g, customPricing.applicant_count?.toString() || '');
      text = text.replace(/{{total_amount}}/g, customPricing.total_amount?.toLocaleString() || '');
      text = text.replace(/{{final_amount}}/g, customPricing.final_amount?.toLocaleString() || '');

      // Handle discount placeholders
      const discountPercentage = Number(customPricing.discount_percentage) || 0;
      const discountAmount = Number(customPricing.discount_amount) || 0;

      if (discountPercentage > 0 && discountAmount > 0) {
        text = text.replace(/{{discount_percentage}}/g, discountPercentage.toString());
        text = text.replace(/{{discount_amount}}/g, discountAmount.toLocaleString());
      } else {
        text = text.replace(/.*discount.*total.*%.*/gi, '');
        text = text.replace(/.*The client receives a discount.*/gi, '');
        text = text.replace(/.*{{discount_percentage}}.*/g, '');
        text = text.replace(/.*{{discount_amount}}.*/g, '');
      }

      text = text.replace(/{{currency}}/g, customPricing.currency || '');

      // Handle payment plan placeholders
      if (customPricing.payment_plan && Array.isArray(customPricing.payment_plan)) {
        customPricing.payment_plan.forEach((row: any, index: number) => {
          const placeholder = `{{payment_${index + 1}_percent}}`;
          const valuePlaceholder = `{{payment_${index + 1}_value}}`;
          const duePlaceholder = `{{payment_${index + 1}_due}}`;

          // Handle the new value format "value + VAT" or just "value"
          let displayValue = '0';
          if (row.value) {
            if (typeof row.value === 'string' && row.value.includes('+')) {
              // Parse "value + VAT" format
              const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
              const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
              displayValue = totalValue.toLocaleString();
            } else {
              // Handle numeric value or simple string
              const numValue = parseFloat(row.value) || 0;
              displayValue = numValue.toLocaleString();
            }
          }

          text = text.replace(new RegExp(placeholder, 'g'), row.percent?.toString() || '0');
          text = text.replace(new RegExp(valuePlaceholder, 'g'), `${customPricing.currency} ${displayValue}`);
          text = text.replace(new RegExp(duePlaceholder, 'g'), row.payment_order || row.label || '');
        });
      }

      // Handle payment plan row placeholders
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        // Handle specific payment plan row placeholders like {{payment_1_row}}, {{payment_2_row}}, etc.
        customPricing.payment_plan.forEach((row: any, index: number) => {
          const specificPlaceholder = `{{payment_${index + 1}_row}}`;
          if (text.includes(specificPlaceholder)) {
            // Handle the new value format "value + VAT" or just "value"
            let displayValue = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Parse "value + VAT" format
                const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
                const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
                displayValue = totalValue.toLocaleString();
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValue = numValue.toLocaleString();
              }
            }
            text = text.replace(new RegExp(specificPlaceholder, 'g'), `${row.percent}% = ${customPricing.currency} ${displayValue}`);
          }
        });

        // Also handle generic {{payment_plan_row}} placeholders (sequential replacement)
        // For readonly/editor mode, we need to replace these placeholders as text
        // For rendering mode, renderTiptapContent will handle them as React components
        if (!globalRowIndex) globalRowIndex = { current: 0 };
        // Replace {{payment_plan_row}} placeholders sequentially
        const placeholderMatches = text.match(/\{\{payment_plan_row\}\}/g);
        if (placeholderMatches) {
          console.log(`🔄 Found ${placeholderMatches.length} {{payment_plan_row}} placeholder(s), payment plan has ${customPricing.payment_plan.length} row(s)`);
        }
        text = text.replace(/\{\{payment_plan_row\}\}/g, (match: string) => {
          const rowIndex = globalRowIndex!.current;
          const row = customPricing.payment_plan[rowIndex];
          console.log(`🔄 Replacing {{payment_plan_row}} #${rowIndex + 1} with row:`, row);
          globalRowIndex!.current++;
          if (row) {
            // Use the exact same value format as shown in the payment plan panel
            let displayValueStr = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Keep the "value + VAT" format exactly as it appears in the panel
                displayValueStr = row.value;
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValueStr = numValue.toString();
              }
            }
            const replacement = `${row.percent}% = ${customPricing.currency} ${displayValueStr}`;
            console.log(`✅ Replaced with: ${replacement}`);
            return replacement;
          }
          console.warn(`⚠️ No payment plan row at index ${rowIndex}`);
          return '';
        });
      }

      // Handle pricing tiers
      if (customPricing.pricing_tiers) {
        const currency = customPricing.currency || 'USD';

        // Get all available tiers in order
        const tierOrder = ['1', '2', '3', '4-7', '8-9', '10-15', '16+'];
        const availableTiers = tierOrder.filter(key =>
          customPricing.pricing_tiers[key] !== undefined &&
          customPricing.pricing_tiers[key] !== null &&
          customPricing.pricing_tiers[key] !== 0
        );

        let currentTierIndex = 0;

        // Find each {{price_per_applicant}} placeholder and replace it based on context
        // Look backwards from the placeholder to find the tier number
        while (text.includes('{{price_per_applicant}}')) {
          const placeholderIndex = text.indexOf('{{price_per_applicant}}');

          // Get context before the placeholder - look at more text to catch tier labels
          const contextBefore = text.substring(Math.max(0, placeholderIndex - 200), placeholderIndex);

          let tierKey: string | null = null;

          // Check for tier patterns in order of specificity (most specific first)
          // Support both English and Hebrew patterns

          // 16+ patterns (English and Hebrew)
          if (/16\s*\+\s*applicant|16\s+or\s+more\s+applicant|16\s+applicant.*or\s+more/i.test(contextBefore) ||
            /16\+?\s*מבקש|מעל\s*16|מ-?16\s*ומעלה/i.test(contextBefore)) {
            tierKey = '16+';
          }
          // 10-15 patterns
          else if (/10\s*[-–]\s*15\s+applicant/i.test(contextBefore) ||
            /10\s*[-–]\s*15\s*מבקש/i.test(contextBefore)) {
            tierKey = '10-15';
          }
          // 8-9 patterns
          else if (/8\s*[-–]\s*9\s+applicant/i.test(contextBefore) ||
            /8\s*[-–]\s*9\s*מבקש/i.test(contextBefore)) {
            tierKey = '8-9';
          }
          // 4-7 patterns
          else if (/4\s*[-–]\s*7\s+applicant/i.test(contextBefore) ||
            /4\s*[-–]\s*7\s*מבקש/i.test(contextBefore)) {
            tierKey = '4-7';
          }
          // 3 applicants
          else if (/\b3\s+applicant/i.test(contextBefore) ||
            /\b3\s*מבקש/i.test(contextBefore)) {
            tierKey = '3';
          }
          // 2 applicants
          else if (/\b2\s+applicant/i.test(contextBefore) ||
            /\b2\s*מבקש|שני\s*מבקש/i.test(contextBefore)) {
            tierKey = '2';
          }
          // 1 applicant - including "לכל מבקש" (for each applicant)
          else if (/\b1\s+applicant|one\s+applicant|For\s+one\s+applicant/i.test(contextBefore) ||
            /\b1\s*מבקש|מבקש\s*אחד|לכל\s*מבקש/i.test(contextBefore)) {
            tierKey = '1';
          }

          // If no specific tier matched, use sequential replacement from available tiers
          if (!tierKey && currentTierIndex < availableTiers.length) {
            tierKey = availableTiers[currentTierIndex];
            console.log(`📝 Using sequential tier: ${tierKey} (index ${currentTierIndex} of ${availableTiers.length})`);
            currentTierIndex++;
          }

          if (tierKey && customPricing.pricing_tiers[tierKey] !== undefined) {
            const price = (customPricing.pricing_tiers[tierKey] || 0).toLocaleString();
            const replacement = `${currency} ${price}`;
            text = text.replace('{{price_per_applicant}}', replacement);
            console.log(`✅ fillPlaceholdersInTiptapContent: Replaced {{price_per_applicant}} for tier ${tierKey} with ${replacement}`);
          } else {
            // If no tier matched, use 0
            const recentContext = contextBefore.substring(contextBefore.length - 80);
            console.warn('⚠️ fillPlaceholdersInTiptapContent: Could not determine tier for {{price_per_applicant}}. Recent context:', recentContext);
            text = text.replace('{{price_per_applicant}}', `${currency} 0`);
          }
        }

        // Also handle specific tier placeholders like {{price_1}}, {{price_2}}, etc.
        Object.keys(customPricing.pricing_tiers).forEach(tierKey => {
          const placeholder = `{{price_${tierKey}}}`;
          if (text.includes(placeholder)) {
            const price = (customPricing.pricing_tiers[tierKey] || 0).toLocaleString();
            text = text.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `${currency} ${price}`);
          }
        });
      }
    }

    // Handle client information
    if (contract && contract.contact_name) {
      text = text.replace(/{{client_name}}/g, contract.contact_name || '');
      text = text.replace(/{{client_phone}}/g, contract.contact_phone || contract.contact_mobile || '');
      text = text.replace(/{{client_email}}/g, contract.contact_email || '');
    } else if (client) {
      text = text.replace(/{{client_name}}/g, client.name || '');
      text = text.replace(/{{client_phone}}/g, client.phone || client.mobile || '');
      text = text.replace(/{{client_email}}/g, client.email || '');
    }

    // Don't replace {{date}} - let renderTiptapContent handle date placeholders as date pickers
    // text = text.replace(/{{date}}/g, new Date().toLocaleDateString());

    // Replace {{text}} and {{signature}} with styled placeholders for view mode
    if (!editing) {
      text = text.replace(/\{\{text\}\}/g, '<span class="text-field-placeholder">[Text Field]</span>');
      text = text.replace(/\{\{signature\}\}/g, '<span class="signature-placeholder"></span>');
    }

    // Skip empty text nodes by returning undefined (will be filtered out)
    if (!text || text.trim() === '') {
      return undefined;
    }

    return { ...content, text };
  }

  if (content.content) {
    const processedContent = fillPlaceholdersInTiptapContent(content.content, customPricing, client, contract, editing, globalRowIndex);
    // Filter out undefined/null values (empty text nodes)
    if (Array.isArray(processedContent)) {
      const filteredContent = processedContent.filter(item => item !== undefined && item !== null);
      return { ...content, content: filteredContent };
    }
    return { ...content, content: processedContent };
  }

  return content;
}

// Helper function to clean up TipTap content and remove empty nodes
function cleanTiptapContent(content: any): any {
  if (!content) return content;

  if (Array.isArray(content)) {
    const cleanedArray = content.map(item => cleanTiptapContent(item));
    return cleanedArray.filter(item => {
      if (item === undefined || item === null) return false;
      if (item.type === 'text') {
        return item.text && item.text.trim() !== '';
      }
      // Always preserve paragraphs - even empty ones represent line breaks
      if (item.type === 'paragraph') {
        return true; // Keep all paragraphs, they represent line breaks
      }
      return true;
    });
  }

  if (content.type === 'text') {
    if (!content.text || content.text.trim() === '') {
      return null;
    }
    return content;
  }

  if (content.content) {
    const cleanedContent = cleanTiptapContent(content.content);
    if (Array.isArray(cleanedContent)) {
      const filteredContent = cleanedContent.filter(item => item !== null);
      // Don't remove doc if it has paragraphs (even empty ones)
      if (filteredContent.length === 0 && content.type !== 'doc') {
        return null;
      }
      return { ...content, content: filteredContent };
    }
    return { ...content, content: cleanedContent };
  }

  return content;
}

// Editor extensions for HTML to TipTap JSON conversion
const editorExtensionsForConversion = [
  StarterKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight,
  Color,
  TextStyle,
  FontFamily,
  FontSize,
];

// Helper function to validate and normalize TipTap content
function normalizeTiptapContent(content: any): any {
  console.log('🔍 normalizeTiptapContent called with:', content);
  console.log('🔍 Content type:', typeof content);
  console.log('🔍 Is array:', Array.isArray(content));
  if (content && typeof content === 'object') {
    console.log('🔍 Content keys:', Object.keys(content));
    console.log('🔍 Has html:', 'html' in content);
    console.log('🔍 Has delta:', 'delta' in content);
    console.log('🔍 Has type:', 'type' in content);
    console.log('🔍 Type value:', content.type);
  }

  // If content is null or undefined, return empty doc
  if (!content) {
    console.log('⚠️ Content is null/undefined, returning empty doc');
    return { type: 'doc', content: [] };
  }

  // If content is a string, try to parse it as JSON
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      console.log('✅ Parsed string content to JSON:', parsed);
      content = parsed;
    } catch (e) {
      console.log('⚠️ Content is a string but not JSON, treating as HTML');
      // Try to convert HTML string to TipTap JSON
      try {
        const converted = generateJSON(content, editorExtensionsForConversion);
        console.log('✅ Successfully converted HTML string to TipTap JSON');
        return converted;
      } catch (conversionError) {
        console.error('❌ Failed to convert HTML string to TipTap JSON:', conversionError);
        return { type: 'doc', content: [] };
      }
    }
  }

  // Check if content has html/delta properties (Quill format - convert HTML to TipTap JSON)
  if (content && typeof content === 'object' && ('html' in content || 'delta' in content)) {
    console.log('🔧 Detected html/delta format, converting HTML to TipTap JSON...');
    const htmlContent = content.html;

    if (htmlContent && typeof htmlContent === 'string') {
      try {
        const converted = generateJSON(htmlContent, editorExtensionsForConversion);
        console.log('✅ Successfully converted HTML to TipTap JSON');
        console.log('🔍 Converted structure:', {
          type: converted?.type,
          hasContent: !!converted?.content,
          contentLength: converted?.content?.length || 0
        });
        return converted;
      } catch (conversionError) {
        console.error('❌ Failed to convert HTML to TipTap JSON:', conversionError);
        console.error('❌ HTML content (first 500 chars):', htmlContent.substring(0, 500));
        return { type: 'doc', content: [] };
      }
    } else {
      console.error('❌ Content has html/delta but html is not a string:', typeof htmlContent);
      return { type: 'doc', content: [] };
    }
  }

  // Check if content is a valid TipTap JSON structure (should have type: 'doc' at root)
  if (content && typeof content === 'object' && content.type === 'doc') {
    // Validate that it has a content array
    if (Array.isArray(content.content)) {
      console.log('✅ Valid TipTap JSON structure detected with content array');
      return content;
    } else {
      console.warn('⚠️ TipTap doc structure but no content array, adding empty array');
      return { type: 'doc', content: content.content || [] };
    }
  }

  // If content is an object but not a valid TipTap doc, try to wrap it
  if (content && typeof content === 'object') {
    // Check if it's already an array (might be content array directly)
    if (Array.isArray(content)) {
      console.log('⚠️ Content is an array, wrapping in doc');
      return { type: 'doc', content: content };
    }

    // Check if it looks like it might be a single node (has type property)
    if (content.type && content.content !== undefined) {
      // It might be a node, wrap it in a doc
      console.log('⚠️ Content looks like a single node, wrapping in doc');
      return { type: 'doc', content: [content] };
    }

    // Check if it has a content property that's an array
    if (content.content && Array.isArray(content.content)) {
      console.log('⚠️ Content has content array but no type:doc, wrapping in doc');
      return { type: 'doc', content: content.content };
    }

    console.error('❌ Unknown content structure - cannot normalize');
    console.error('❌ Content:', JSON.stringify(content, null, 2).substring(0, 500));
    return { type: 'doc', content: [] };
  }

  // Fallback: return empty doc
  console.error('❌ Could not normalize content - unsupported type or structure');
  console.error('❌ Content:', content);
  return { type: 'doc', content: [] };
}

function preprocessTemplatePlaceholders(content: any): any {
  console.log('🔧 preprocessTemplatePlaceholders called with:', content);

  // First normalize the content to ensure it's valid TipTap JSON
  const normalizedContent = normalizeTiptapContent(content);

  let textId = 1;
  let signatureId = 1;

  function processContent(content: any): any {
    if (!content) return content;
    if (Array.isArray(content)) {
      return content.map(processContent);
    }
    if (content.type === 'text' && content.text) {
      console.log('🔧 Processing text node:', content.text);
      let newText = content.text.replace(/\{\{text\}\}/g, () => `{{text:text-${textId++}}}`)
        .replace(/\{\{signature\}\}/g, () => `{{signature:signature-${signatureId++}}}`);
      console.log('🔧 Processed text node:', newText);
      return { ...content, text: newText };
    }
    if (content.content) {
      return { ...content, content: processContent(content.content) };
    }
    return content;
  }

  const result = processContent(normalizedContent);
  console.log('🔧 preprocessTemplatePlaceholders result:', result);
  return result;
}

// Function to convert template content to preserve line breaks
function convertTemplateToLineBreaks(content: any): any {
  if (!content) return content;
  if (Array.isArray(content)) {
    return content.map(convertTemplateToLineBreaks);
  }

  // If this is a paragraph with multiple text nodes, combine them with line breaks
  if (content.type === 'paragraph' && content.content && content.content.length > 1) {
    const textNodes = content.content.filter((node: any) => node.type === 'text');
    if (textNodes.length > 1) {
      // Combine all text nodes with line breaks
      const combinedText = textNodes.map((node: any) => node.text).join('\n');
      return {
        ...content,
        content: [{ type: 'text', text: combinedText }]
      };
    }
  }

  if (content.content) {
    return { ...content, content: convertTemplateToLineBreaks(content.content) };
  }
  return content;
}

// Helper to build correct payment plan
function buildPaymentPlan(finalAmount: number, archivalFee: number) {
  const plan = [];
  if (archivalFee > 0) {
    plan.push({
      percent: 100,
      due_date: 'On signing',
      value: archivalFee,
      label: 'Archival Research',
    });
  }
  if (finalAmount > 0) {
    plan.push(
      { percent: 50, due_date: 'On signing', value: Math.round(finalAmount * 0.5), label: 'First Payment' },
      { percent: 25, due_date: '30 days', value: Math.round(finalAmount * 0.25), label: 'Intermediate Payment' },
      { percent: 25, due_date: '60 days', value: Math.round(finalAmount * 0.25), label: 'Final Payment' }
    );
  }
  return plan;
}


const ContractPage: React.FC = () => {
  const { leadNumber: paramLeadNumber, contractId: paramContractId } = useParams<{ leadNumber?: string; contractId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Extract leadNumber from URL path manually (may be undefined if using /contract/:contractId route)
  const leadNumber = paramLeadNumber || (location.pathname.startsWith('/contract/') ? undefined : location.pathname.split('/')[2]);
  // Extract contractId from URL - can be from route param or query string
  const contractId = paramContractId || new URLSearchParams(location.search).get('contractId') || (location.pathname.startsWith('/contract/') ? location.pathname.split('/')[2] : null);

  const [contract, setContract] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allCurrencies, setAllCurrencies] = useState<Array<{ id: number | string, name: string, iso_code: string | null }>>([]);

  // Fetch categories (same logic as ClientHeader.tsx)
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            misc_maincategory ( id, name )
          `)
          .order('name');

        if (error) throw error;
        setAllCategories(data || []);
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };
    fetchCategories();
  }, []);

  // Fetch employees
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo')
          .order('display_name', { ascending: true });

        if (error) throw error;
        setAllEmployees(data || []);
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };
    fetchEmployees();
  }, []);

  // Fetch currencies
  useEffect(() => {
    const fetchCurrencies = async () => {
      try {
        const { data, error } = await supabase
          .from('accounting_currencies')
          .select('id, name, iso_code')
          .order('order', { ascending: true, nullsFirst: false });

        if (error) throw error;
        setAllCurrencies(data || []);
      } catch (error) {
        console.error('Error fetching currencies:', error);
      }
    };
    fetchCurrencies();
  }, []);

  // Helper function to get category display name with main category (same logic as ClientHeader.tsx)
  const getCategoryDisplayName = (categoryId: number | string | null | undefined, fallbackCategory?: string): string => {
    if (!categoryId) {
      return fallbackCategory || '';
    }

    const category = allCategories.find((cat: any) => {
      const catId = typeof cat.id === 'bigint' ? Number(cat.id) : cat.id;
      const searchId = typeof categoryId === 'string' ? parseInt(categoryId, 10) : categoryId;
      return catId === searchId || Number(catId) === Number(searchId);
    });

    if (category) {
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name;
      }
    }

    return fallbackCategory || '';
  };

  // Helper function to render lead number (same logic as ClientHeader.tsx)
  const renderLeadNumber = (): string => {
    if (!client) return leadNumber || 'N/A';

    // For new leads, id is a UUID, so we should not use it as a fallback
    // Only use id for legacy leads (where id is numeric)
    const isLegacyLead = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_') ||
      (typeof client.id === 'number' || (typeof client.id === 'string' && !isNaN(Number(client.id)) && !client.id.includes('-')));

    // Priority: lead_number > manual_id > (id only for legacy) > leadNumber param > 'N/A'
    let displayNumber: string | number;
    if (client.lead_number) {
      displayNumber = client.lead_number;
    } else if (client.manual_id) {
      displayNumber = client.manual_id;
    } else if (isLegacyLead && client.id) {
      // For legacy leads, id is numeric, so we can use it
      displayNumber = client.id;
    } else if (leadNumber) {
      displayNumber = leadNumber;
    } else {
      return 'N/A';
    }

    const displayStr = displayNumber.toString();
    const hasExistingSuffix = displayStr.includes('/');
    let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
    const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;

    // Convert L to C for success stage (stage 100)
    const isSuccessStage = client.stage === '100' || client.stage === 100;
    if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
      baseNumber = baseNumber.toString().replace(/^L/, 'C');
    }

    // Add /1 suffix to master leads (frontend only)
    // A lead is a master if: it has no master_id AND it has subleads
    const hasNoMasterId = !client.master_id || String(client.master_id).trim() === '';
    // Note: We don't have subLeadsCount in ContractPage, so we'll skip the /1 suffix logic
    // If needed, this could be added by fetching subleads count
    const hasSubLeads = false; // ContractPage doesn't track this, but keeping structure for consistency

    // Only add /1 to master leads that actually have subleads
    // Since we don't have subLeadsCount, we'll skip this part
    // if (isMasterWithSubLeads && !hasExistingSuffix) {
    //   return `${baseNumber}/1`;
    // } else if (hasExistingSuffix) {
    //   return `${baseNumber}/${existingSuffix}`;
    // }

    if (hasExistingSuffix) {
      return `${baseNumber}/${existingSuffix}`;
    }
    return baseNumber;
  };

  // Helper function to get employee display name from ID (same logic as ClientHeader.tsx)
  const getEmployeeDisplayNameFromId = (employeeId: string | number | null | undefined): string => {
    if (!employeeId || employeeId === '---' || employeeId === null || employeeId === undefined) return '---';
    if (!allEmployees || allEmployees.length === 0) return '---';

    const idAsNumber = typeof employeeId === 'string' ? parseInt(employeeId, 10) : Number(employeeId);
    if (isNaN(idAsNumber)) return '---';

    const employee = allEmployees.find((emp: any) => {
      if (!emp || !emp.id) return false;
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : Number(emp.id));
      return !isNaN(empId) && empId === idAsNumber;
    });

    return employee?.display_name || '---';
  };

  // Helper function to get employee by ID
  const getEmployeeById = (employeeId: string | number | null | undefined) => {
    if (!employeeId || employeeId === '---' || employeeId === '--' || employeeId === '') {
      return null;
    }

    const employeeById = allEmployees.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof employeeId === 'string' ? parseInt(employeeId, 10) : employeeId;

      if (isNaN(Number(searchId))) return false;

      if (empId.toString() === searchId.toString()) return true;
      if (Number(empId) === Number(searchId)) return true;

      return false;
    });

    if (employeeById) {
      return employeeById;
    }

    if (typeof employeeId === 'string') {
      const employeeByName = allEmployees.find((emp: any) => {
        if (!emp.display_name) return false;
        return emp.display_name.trim().toLowerCase() === employeeId.trim().toLowerCase();
      });

      if (employeeByName) {
        return employeeByName;
      }
    }

    return null;
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Track image errors per employee to prevent flickering
  const imageErrorCache = useRef<Map<string | number, boolean>>(new Map());

  // Component to render employee avatar (same as ClientHeader.tsx)
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';

    if (!employee) {
      return null;
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    const cacheKey = employeeId?.toString() || '';
    const cachedError = imageErrorCache.current.get(cacheKey) || false;
    const hasError = cachedError || imageError;

    if (hasError || !photoUrl) {
      return (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0`}
          title={employee.display_name}
        >
          {initials}
        </div>
      );
    }

    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0`}
        onError={() => {
          if (cacheKey) {
            imageErrorCache.current.set(cacheKey, true);
          }
          setImageError(true);
        }}
        title={employee.display_name}
      />
    );
  };

  // Helper function to get currency name from accounting_currencies table (same logic as ClientHeader.tsx)
  const getCurrencyName = (currencyId: string | number | null | undefined): string => {
    if (!currencyId || currencyId === null || currencyId === undefined) {
      return '₪'; // Default fallback
    }

    if (!allCurrencies || allCurrencies.length === 0) {
      return '₪'; // Default fallback until currencies load
    }

    const currencyIdNum = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
    if (isNaN(currencyIdNum)) {
      return '₪'; // Default fallback
    }

    const currency = allCurrencies.find((curr: any) => {
      if (!curr || !curr.id) return false;
      const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
      const currIdNum = typeof currId === 'string' ? parseInt(currId, 10) : Number(currId);
      return !isNaN(currIdNum) && currIdNum === currencyIdNum;
    });

    if (currency && currency.name && currency.name.trim() !== '') {
      return currency.name.trim();
    }

    return '₪';
  };

  const [signaturePads, setSignaturePads] = useState<{ [key: string]: any }>({});
  const [editing, setEditing] = useState(false);
  const [contractStatuses, setContractStatuses] = useState<{ [id: string]: { status: string; signed_at?: string } }>({});

  // Editable right panel state
  const [customPricing, setCustomPricing] = useState<any>(null);
  const [renderKey, setRenderKey] = useState(0);

  // Currency selection state
  const [currencyType, setCurrencyType] = useState<'USD' | 'NIS'>('USD'); // Main currency type (USD or NIS)
  const [subCurrency, setSubCurrency] = useState<'USD' | 'GBP' | 'EUR'>('USD'); // Sub-currency for USD type

  // VAT included/excluded state (default: included for NIS, excluded for USD/GBP/EUR)
  const [vatIncluded, setVatIncluded] = useState<boolean>(false);

  // Template change modal state
  const [showChangeTemplateModal, setShowChangeTemplateModal] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);

  // Contract Details & Pricing Modal state
  const [showDetailsAndPricingModal, setShowDetailsAndPricingModal] = useState(false);
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [templateLanguageFilter, setTemplateLanguageFilter] = useState<string | null>(null);

  // Call and Email modals state
  const [showCallContactModal, setShowCallContactModal] = useState(false);
  const [showEmailContactModal, setShowEmailContactModal] = useState(false);
  const [availableContacts, setAvailableContacts] = useState<ContactInfo[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callPhoneNumber, setCallPhoneNumber] = useState('');
  const [callContactName, setCallContactName] = useState('');
  const [availableLanguages, setAvailableLanguages] = useState<any[]>([]);

  // TipTap editor setup for editing - must be called before any early returns
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: {
          HTMLAttributes: {
            dir: 'auto',
          },
        },
        heading: {
          HTMLAttributes: {
            dir: 'auto',
          },
        },
        hardBreak: {
          keepMarks: true,
        },
        bulletList: {
          HTMLAttributes: {
            dir: 'auto',
          },
        },
        orderedList: {
          HTMLAttributes: {
            dir: 'auto',
          },
        },
      }),
      Placeholder.configure({ placeholder: 'Edit contract...' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight,
      Color,
      TextStyle,
      FontFamily,
      FontSize,
    ],
    content: { type: 'doc', content: [] }, // Default empty content
    editable: false,
    parseOptions: {
      preserveWhitespace: 'full',
    },
    editorProps: {
      handleKeyDown: (view, event) => {
        // Let TipTap handle all keys normally
        return false;
      },
    },
  });

  // Field insertion constants (similar to ContractTemplatesManager)
  const DYNAMIC_FIELDS = [
    { label: 'Client Name', tag: '{{client_name}}' },
    { label: 'Client Phone', tag: '{{client_phone}}' },
    { label: 'Client Email', tag: '{{client_email}}' },
    { label: 'Signature', tag: '{{signature}}' },
    { label: 'Date', tag: '{{date}}' },
  ];

  const FIELD_TYPES = [
    { label: 'Text Field (Generic)', tag: '{{text}}' },
    { label: 'Applicant Name', tag: '{{text:applicant}}' },
    { label: 'Document Name', tag: '{{text:document}}' },
    { label: 'Country', tag: '{{text:country}}' },
    { label: 'Address', tag: '{{text:address}}' },
    { label: 'City', tag: '{{text:city}}' },
    { label: 'Postal Code', tag: '{{text:postal}}' },
    { label: 'Notes', tag: '{{text:notes}}' },
    { label: 'Reference Number', tag: '{{text:reference}}' },
    { label: 'Other Text', tag: '{{text:other}}' },
    { label: 'Signature Field', tag: '{{signature}}' },
    { label: 'Date Field', tag: '{{date}}' },
  ];

  const PRICING_FIELDS = [
    { label: 'Applicant Count', tag: '{{applicant_count}}' },
    { label: 'Price Per Applicant', tag: '{{price_per_applicant}}' },
    { label: 'Total Amount', tag: '{{total_amount}}' },
    { label: 'Discount Percentage', tag: '{{discount_percentage}}' },
    { label: 'Discount Amount', tag: '{{discount_amount}}' },
    { label: 'Final Amount', tag: '{{final_amount}}' },
    { label: 'Currency', tag: '{{currency}}' },
  ];

  const PAYMENT_PLAN_FIELDS = [
    { label: 'Payment Plan Row', tag: '{{payment_plan_row}}' },
    { label: 'Payment Percent', tag: '{{payment_1_percent}}' },
    { label: 'Payment Due', tag: '{{payment_1_due}}' },
    { label: 'Payment Amount', tag: '{{payment_1_value}}' },
  ];

  // Insert field into editor
  const insertField = (tag: string) => {
    if (editor && editing) {
      editor.chain().focus().insertContent(tag).run();
    }
  };

  // Add at the top, after useState declarations
  const [clientInputs, setClientInputs] = useState<{ [key: string]: string }>({});

  // State for draggable fields
  const [draggableFields, setDraggableFields] = useState<Array<{ id: string; type: 'text' | 'date' | 'signature'; x: number; y: number }>>([]);
  const [draggingField, setDraggingField] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // State to track editor content changes for re-rendering placeholders as input boxes
  const [editorContentKey, setEditorContentKey] = useState(0);

  // State to track positions of draggable fields in edit mode
  const [fieldPositions, setFieldPositions] = useState<{ [key: string]: { x: number; y: number } }>({});
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

  // Collapse/expand state for individual boxes
  const [isContractDetailsExpanded, setIsContractDetailsExpanded] = useState(true);
  const [isPricingExpanded, setIsPricingExpanded] = useState(true);

  // Track last content hash to prevent unnecessary updates
  const lastContentHashRef = useRef<string>('');
  const lastEditingStateRef = useRef<boolean>(false);

  // Ref to measure header height for sidebar positioning
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(80);

  // Ref for contract content area (for PDF generation)
  const contractContentRef = useRef<HTMLDivElement>(null);

  // PDF loading state
  const [pdfLoading, setPdfLoading] = useState(false);

  // Measure header height for sidebar positioning
  useEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
        const height = headerRef.current.offsetHeight;
        setHeaderHeight(height);
      }
    };

    // Initial measurement
    updateHeaderHeight();

    // Update on window resize
    window.addEventListener('resize', updateHeaderHeight);

    // Use ResizeObserver for more accurate measurements
    const resizeObserver = new ResizeObserver(() => {
      updateHeaderHeight();
    });

    if (headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateHeaderHeight);
      resizeObserver.disconnect();
    };
  }, []); // ResizeObserver handles all changes automatically

  // Fetch client data
  useEffect(() => {
    const fetchClient = async () => {
      if (!leadNumber) {
        return;
      }
      try {
        console.log('ContractPage: fetchClient called with leadNumber:', leadNumber);

        // Check if this is a legacy lead
        const isLegacyLead = leadNumber?.toString().startsWith('legacy_') ||
          (!isNaN(Number(leadNumber)));

        console.log('ContractPage: fetchClient - isLegacyLead:', isLegacyLead);

        let clientData = null;

        if (isLegacyLead) {
          // For legacy leads, fetch from leads_lead table with currency information
          const legacyId = leadNumber.toString().replace('legacy_', '');
          console.log('ContractPage: fetchClient - fetching from leads_lead with id:', legacyId);

          const { data: legacyClient, error: legacyError } = await supabase
            .from('leads_lead')
            .select(`
              *,
              accounting_currencies!leads_lead_currency_id_fkey (
                id,
                iso_code,
                name
              )
            `)
            .eq('id', legacyId)
            .single();

          if (legacyError) {
            console.error('ContractPage: Error fetching legacy client:', legacyError);
            return;
          }

          if (legacyClient) {
            // Get currency from accounting_currencies
            let currency = '₪'; // Default
            const currencyData = Array.isArray(legacyClient.accounting_currencies)
              ? legacyClient.accounting_currencies[0]
              : legacyClient.accounting_currencies;
            if (currencyData) {
              const isoCode = currencyData.iso_code?.toUpperCase();
              if (isoCode === 'ILS' || isoCode === 'NIS') currency = '₪';
              else if (isoCode === 'USD') currency = '$';
              else if (isoCode === 'EUR') currency = '€';
              else if (isoCode === 'GBP') currency = '£';
              else currency = isoCode || currencyData.name || '₪';
            } else if (legacyClient.currency_id) {
              // Fallback: map currency_id to symbol
              switch (legacyClient.currency_id) {
                case 1: currency = '₪'; break;
                case 2: currency = '$'; break;
                case 3: currency = '€'; break;
                default: currency = '₪';
              }
            }

            // Transform legacy client to match new client structure
            clientData = {
              ...legacyClient,
              id: `legacy_${legacyClient.id}`,
              lead_number: String(legacyClient.id),
              stage: String(legacyClient.stage || ''),
              source: String(legacyClient.source_id || ''),
              created_at: legacyClient.cdate,
              updated_at: legacyClient.udate,
              notes: legacyClient.notes || '',
              special_notes: legacyClient.special_notes || '',
              next_followup: legacyClient.next_followup || '',
              probability: String(legacyClient.probability || ''),
              category: String(legacyClient.category_id || legacyClient.category || ''),
              language: String(legacyClient.language_id || ''),
              balance: String(legacyClient.total || ''),
              lead_type: 'legacy',
              client_country: null,
              closer: legacyClient.closer_id || null, // Preserve closer_id for legacy leads
              closer_id: legacyClient.closer_id || null, // Also keep closer_id field
              handler: null,
              unactivation_reason: null,
              balance_currency: currency, // Store currency for consistency
            };

          }
        } else {
          // For new leads, fetch from leads table
          console.log('ContractPage: fetchClient - fetching from leads with id:', leadNumber);

          const { data: newClient, error: newError } = await supabase
            .from('leads')
            .select('*')
            .eq('lead_number', leadNumber)
            .single();

          if (newError) {
            console.error('ContractPage: Error fetching new client:', newError);
            return;
          }

          clientData = newClient;
        }

        console.log('ContractPage: fetchClient - setting client data:', clientData);
        setClient(clientData);

      } catch (error) {
        console.error('ContractPage: Error in fetchClient:', error);
      }
    };

    // Fetch client either by leadNumber or after contract is loaded
    if (leadNumber) {
      fetchClient();
    }
    // If we only have contractId, we'll fetch client after contract is loaded
  }, [leadNumber]);

  // Fetch contract data
  useEffect(() => {
    const fetchContract = async () => {
      try {
        console.log('ContractPage: fetchContract called with:', { leadNumber, contractId });

        let query = supabase
          .from('contracts')
          .select(`
            *,
            contract_templates (
              id,
              name,
              content,
              default_pricing_tiers_usd,
              default_pricing_tiers_nis,
              default_pricing_tiers
            )
          `);

        // If we only have contractId (no leadNumber), fetch contract directly
        if (contractId && !leadNumber) {
          console.log('ContractPage: Fetching contract directly by contractId:', contractId);
          query = query.eq('id', contractId);
        } else if (leadNumber) {
          // Check if this is a legacy lead
          // Legacy leads can be identified by:
          // 1. Starting with 'legacy_' prefix
          // 2. Being a numeric string (UUIDs are not numeric)
          const isLegacyLead = leadNumber.toString().startsWith('legacy_') ||
            (!isNaN(Number(leadNumber)));

          console.log('ContractPage: isLegacyLead:', isLegacyLead, 'leadNumber:', leadNumber);

          if (isLegacyLead) {
            // For legacy leads, use legacy_id
            const legacyId = leadNumber.toString().replace('legacy_', '');
            console.log('ContractPage: Using legacy_id:', legacyId);
            query = query.eq('legacy_id', legacyId);
          } else {
            // For new leads, we need to get the UUID from the leads table first
            console.log('ContractPage: Fetching UUID for lead_number:', leadNumber);
            const { data: leadData, error: leadError } = await supabase
              .from('leads')
              .select('id')
              .eq('lead_number', leadNumber)
              .single();

            if (leadError) {
              console.error('ContractPage: Error fetching lead UUID:', leadError);
              return;
            }

            if (!leadData) {
              console.error('ContractPage: No lead found for lead_number:', leadNumber);
              return;
            }

            console.log('ContractPage: Using client_id (UUID):', leadData.id);
            query = query.eq('client_id', leadData.id);
          }

          // If we have a specific contractId, filter by that too
          if (contractId) {
            console.log('ContractPage: Also filtering by contractId:', contractId);
            query = query.eq('id', contractId);
          }
        } else {
          console.error('ContractPage: No contractId or leadNumber provided');
          setLoading(false);
          return;
        }

        console.log('ContractPage: Executing query...');
        let { data: contractData, error } = await query.maybeSingle();

        console.log('ContractPage: Query result:', { contractData, error });

        // If no contract found in contracts table and this is a legacy lead, try lead_leadcontact table
        if (!contractData && leadNumber) {
          const isLegacyLead = leadNumber.toString().startsWith('legacy_') ||
            (!isNaN(Number(leadNumber)));

          if (isLegacyLead) {
            const legacyId = leadNumber.toString().replace('legacy_', '');
            console.log('ContractPage: No contract in contracts table, trying lead_leadcontact for legacy_id:', legacyId);

            // Try fetching from lead_leadcontact table
            const { data: legacyContractData, error: legacyError } = await supabase
              .from('lead_leadcontact')
              .select('*')
              .eq('lead_id', legacyId)
              .maybeSingle();

            if (!legacyError && legacyContractData) {
              // Check if there's contract HTML
              const hasContractHtml = legacyContractData.contract_html && legacyContractData.contract_html.trim() !== '' && legacyContractData.contract_html !== '\\N';
              const hasSignedContractHtml = legacyContractData.signed_contract_html && legacyContractData.signed_contract_html.trim() !== '' && legacyContractData.signed_contract_html !== '\\N';

              if (hasContractHtml || hasSignedContractHtml) {
                // Transform legacy contract to match contracts table format for ContractPage
                contractData = {
                  id: `legacy_${legacyContractData.id}`,
                  legacy_id: legacyId,
                  contract_html: hasContractHtml ? legacyContractData.contract_html : null,
                  signed_contract_html: hasSignedContractHtml ? legacyContractData.signed_contract_html : null,
                  status: hasSignedContractHtml ? 'signed' : 'draft',
                  isLegacyContract: true,
                  lead_leadcontact_id: legacyContractData.id
                };
                error = null;
                console.log('ContractPage: Found legacy contract in lead_leadcontact:', contractData);
              }
            }
          }
        }

        if (error) {
          console.error('Error fetching contract:', error);
          setLoading(false);
          return;
        }

        if (!contractData) {
          console.error('ContractPage: No contract found');
          setLoading(false);
          return;
        }

        console.log('ContractPage: Setting contract data:', contractData);
        setContract(contractData);

        // If we don't have leadNumber but have a contract, fetch the client from the contract's client_id or legacy_id
        let clientLoaded = false;
        if (!leadNumber && (contractData.client_id || contractData.legacy_id)) {
          try {
            let clientData = null;
            let clientError = null;

            // Check if this is a legacy lead (has legacy_id but no client_id)
            if (contractData.legacy_id && !contractData.client_id) {
              console.log('ContractPage: Fetching legacy client from contract legacy_id:', contractData.legacy_id);
              const { data: legacyClient, error: legacyError } = await supabase
                .from('leads_lead')
                .select(`
                  *,
                  accounting_currencies!leads_lead_currency_id_fkey (
                    id,
                    iso_code,
                    name
                  )
                `)
                .eq('id', contractData.legacy_id)
                .single();

              if (legacyError) {
                console.error('ContractPage: Error fetching legacy client:', legacyError);
                clientError = legacyError;
              } else if (legacyClient) {
                // Transform legacy client to match new client structure
                // Get currency from accounting_currencies
                let currency = '₪'; // Default
                const currencyData = Array.isArray(legacyClient.accounting_currencies)
                  ? legacyClient.accounting_currencies[0]
                  : legacyClient.accounting_currencies;
                if (currencyData) {
                  const isoCode = currencyData.iso_code?.toUpperCase();
                  if (isoCode === 'ILS' || isoCode === 'NIS') currency = '₪';
                  else if (isoCode === 'USD') currency = '$';
                  else if (isoCode === 'EUR') currency = '€';
                  else if (isoCode === 'GBP') currency = '£';
                  else currency = isoCode || currencyData.name || '₪';
                } else if (legacyClient.currency_id) {
                  // Fallback: map currency_id to symbol
                  switch (legacyClient.currency_id) {
                    case 1: currency = '₪'; break;
                    case 2: currency = '$'; break;
                    case 3: currency = '€'; break;
                    default: currency = '₪';
                  }
                }

                clientData = {
                  ...legacyClient,
                  id: `legacy_${legacyClient.id}`,
                  lead_number: String(legacyClient.id),
                  stage: String(legacyClient.stage || ''),
                  source: String(legacyClient.source_id || ''),
                  created_at: legacyClient.cdate,
                  updated_at: legacyClient.udate,
                  notes: legacyClient.notes || '',
                  special_notes: legacyClient.special_notes || '',
                  next_followup: legacyClient.next_followup || '',
                  probability: String(legacyClient.probability || ''),
                  category: String(legacyClient.category_id || legacyClient.category || ''),
                  language: String(legacyClient.language_id || ''),
                  balance: String(legacyClient.total || ''),
                  lead_type: 'legacy',
                  client_country: null,
                  closer: legacyClient.closer_id || null, // Preserve closer_id for legacy leads
                  closer_id: legacyClient.closer_id || null, // Also keep closer_id field
                  handler: null,
                  unactivation_reason: null,
                  balance_currency: legacyClient.accounting_currencies?.name || (() => {
                    // Fallback currency mapping based on currency_id
                    switch (legacyClient.currency_id) {
                      case 1: return '₪';
                      case 2: return '€';
                      case 3: return '$';
                      case 4: return '£';
                      default: return '₪';
                    }
                  })(),
                };
              }
            } else if (contractData.client_id) {
              // For new leads, fetch from leads table
              console.log('ContractPage: Fetching client from contract client_id:', contractData.client_id);
              const { data: newClient, error: newError } = await supabase
                .from('leads')
                .select('*')
                .eq('id', contractData.client_id)
                .single();

              if (newError) {
                console.error('ContractPage: Error fetching client:', newError);
                clientError = newError;
              } else {
                clientData = newClient;
              }
            }

            if (clientError) {
              console.error('ContractPage: Error fetching client from contract:', clientError);
              // Don't return - continue to set loading to false
            } else if (clientData) {
              console.log('ContractPage: Setting client data from contract:', clientData);
              setClient(clientData);
              clientLoaded = true;
            }
          } catch (err) {
            console.error('ContractPage: Exception fetching client:', err);
            // Don't return - continue to set loading to false
          }
        } else if (leadNumber) {
          // Client should already be loaded from the fetchClient useEffect
          clientLoaded = true;
        }

        // Fetch template - check if it's a legacy template or new template
        let templateData = contractData.contract_templates;

        // If no template from join, check if we need to fetch from misc_contracttemplate (legacy)
        // This can happen if:
        // 1. template_id is set but join didn't work
        // 2. template_id is NULL and legacy_template_id is in custom_pricing (new scenario)
        if (!templateData) {
          // First check if template_id is set
          if (contractData.template_id) {
            console.log('ContractPage: No template from join, checking if legacy template:', contractData.template_id);
            const isLegacyTemplate = !isNaN(Number(contractData.template_id)) || contractData.template_id.toString().startsWith('legacy_');

            if (isLegacyTemplate) {
              const templateId = contractData.template_id.toString().replace('legacy_', '');
              console.log('ContractPage: Fetching legacy template from misc_contracttemplate:', templateId);
              const { data: legacyTemplate, error: legacyTemplateError } = await supabase
                .from('misc_contracttemplate')
                .select('*')
                .eq('id', templateId)
                .single();

              if (!legacyTemplateError && legacyTemplate) {
                console.log('ContractPage: Found legacy template:', legacyTemplate);
                templateData = legacyTemplate;
              } else {
                console.error('ContractPage: Error fetching legacy template:', legacyTemplateError);
              }
            } else {
              // Not a legacy template, try fetching from contract_templates
              console.log('ContractPage: Fetching template from contract_templates:', contractData.template_id);
              const { data: newTemplate, error: newTemplateError } = await supabase
                .from('contract_templates')
                .select('*')
                .eq('id', contractData.template_id)
                .single();

              if (!newTemplateError && newTemplate) {
                console.log('ContractPage: Found template from contract_templates:', newTemplate);
                templateData = newTemplate;
              } else {
                console.error('ContractPage: Error fetching template from contract_templates:', newTemplateError);
              }
            }
          }
          // If template_id is NULL, check for legacy_template_id in custom_pricing
          else if (contractData.custom_pricing?.legacy_template_id) {
            const legacyTemplateId = contractData.custom_pricing.legacy_template_id;
            console.log('ContractPage: template_id is NULL, fetching legacy template from custom_pricing.legacy_template_id:', legacyTemplateId);
            const { data: legacyTemplate, error: legacyTemplateError } = await supabase
              .from('misc_contracttemplate')
              .select('*')
              .eq('id', legacyTemplateId)
              .single();

            if (!legacyTemplateError && legacyTemplate) {
              console.log('ContractPage: Found legacy template from custom_pricing:', legacyTemplate);
              templateData = legacyTemplate;
            } else {
              console.error('ContractPage: Error fetching legacy template from custom_pricing:', legacyTemplateError);
            }
          }
        }

        // Set the template if available
        if (templateData) {
          console.log('Original template content:', templateData.content);
          // Process template to add text and signature placeholders
          const processedTemplate = {
            ...templateData,
            content: templateData.content ?
              preprocessTemplatePlaceholders(templateData.content) :
              templateData.content
          };
          console.log('📋 Processed template content:', processedTemplate.content);
          console.log('📋 Setting template:', processedTemplate);
          setTemplate(processedTemplate);

          // Immediately set the editor content if editor is available
          if (editor && processedTemplate.content) {
            console.log('🎯 Setting editor content immediately:', processedTemplate.content);

            // Normalize content to ensure it's valid TipTap JSON
            let processedContent = normalizeTiptapContent(processedTemplate.content);
            processedContent = JSON.parse(JSON.stringify(processedContent)); // Deep clone

            if (customPricing && client) {
              // Replace pricing and other placeholders but keep {{text}} and {{signature}} for the custom renderer
              processedContent = fillPlaceholdersInTiptapContent(processedContent, customPricing, client, contract, editing, { current: 0 });
            }

            // Clean up any empty nodes
            processedContent = cleanTiptapContent(processedContent);

            // Final validation before setting content
            if (!processedContent || processedContent.type !== 'doc') {
              console.error('❌ Invalid content after processing, resetting to empty doc. Content:', processedContent);
              processedContent = { type: 'doc', content: [] };
            }

            try {
              editor.commands.setContent(processedContent);
              editor.setEditable(editing);
            } catch (error) {
              console.error('❌ Error setting editor content:', error);
              console.error('❌ Content that failed:', processedContent);
              // Try with empty doc as fallback
              editor.commands.setContent({ type: 'doc', content: [] });
              editor.setEditable(editing);
            }
          }
        }

        // Get currency symbol based on selection
        const getCurrencySymbol = (type: 'USD' | 'NIS', sub?: 'USD' | 'GBP' | 'EUR') => {
          if (type === 'NIS') return '₪';
          if (sub === 'EUR') return '€';
          if (sub === 'GBP') return '£';
          return '$';
        };

        // Set the custom pricing if available
        if (contractData.custom_pricing) {
          console.log('ContractPage: Setting custom pricing:', contractData.custom_pricing);
          // Determine currency type from existing pricing (use contract's currency, not lead's)
          const existingCurrency = contractData.custom_pricing.currency || templateData?.default_currency || '$';
          const existingIsNIS = existingCurrency === '₪' || existingCurrency === 'ILS' || existingCurrency === 'NIS';
          const existingCurrencyType = existingIsNIS ? 'NIS' : 'USD';
          let existingSubCurrency: 'USD' | 'GBP' | 'EUR' = 'USD';
          if (!existingIsNIS) {
            if (existingCurrency === '€' || existingCurrency === 'EUR') existingSubCurrency = 'EUR';
            else if (existingCurrency === '£' || existingCurrency === 'GBP') existingSubCurrency = 'GBP';
            else existingSubCurrency = 'USD';
          }

          setCurrencyType(existingCurrencyType);
          if (!existingIsNIS) setSubCurrency(existingSubCurrency);

          // Refresh pricing tiers from template defaults while keeping user customizations
          let refreshedPricingTiers: { [key: string]: number } = { ...contractData.custom_pricing.pricing_tiers };

          if (templateData) {
            // Get fresh pricing tiers from template based on currency type
            let templatePricingTiers: { [key: string]: number } = {};
            if (existingCurrencyType === 'NIS' && templateData.default_pricing_tiers_nis) {
              templatePricingTiers = templateData.default_pricing_tiers_nis;
            } else if (existingCurrencyType === 'USD' && templateData.default_pricing_tiers_usd) {
              templatePricingTiers = templateData.default_pricing_tiers_usd;
            } else if (templateData.default_pricing_tiers) {
              // Fallback to legacy default_pricing_tiers
              templatePricingTiers = templateData.default_pricing_tiers;
            }

            // Update pricing tiers with fresh template defaults
            if (Object.keys(templatePricingTiers).length > 0) {
              console.log('ContractPage: Refreshing pricing tiers from template defaults:', templatePricingTiers);
              refreshedPricingTiers = { ...templatePricingTiers };
            }
          }

          // Recalculate totals if pricing tiers were updated
          const applicantCount = contractData.custom_pricing.applicant_count || contractData.applicant_count || 1;
          const getCurrentTierKey = (count: number) => {
            if (count === 1) return '1';
            if (count === 2) return '2';
            if (count === 3) return '3';
            if (count >= 4 && count <= 7) return '4-7';
            if (count >= 8 && count <= 9) return '8-9';
            if (count >= 10 && count <= 15) return '10-15';
            return '16+';
          };

          const currentTierKey = getCurrentTierKey(applicantCount);
          const currentPricePerApplicant = refreshedPricingTiers[currentTierKey] || contractData.custom_pricing.pricing_tiers?.[currentTierKey] || 0;

          // Recalculate total_amount based on refreshed pricing tiers
          const recalculatedTotal = currentPricePerApplicant * applicantCount;

          // Preserve user customizations but update pricing tiers and recalculated totals
          // IMPORTANT: Preserve existing payment_plan if it exists, don't overwrite it
          const pricingWithVat = {
            ...contractData.custom_pricing,
            pricing_tiers: refreshedPricingTiers, // Use fresh template defaults
            total_amount: recalculatedTotal, // Recalculate based on fresh tiers
            // Recalculate final_amount if no discount, otherwise preserve discount but update base
            final_amount: contractData.custom_pricing.discount_percentage
              ? Math.round(recalculatedTotal * (1 - (contractData.custom_pricing.discount_percentage / 100)))
              : recalculatedTotal,
            discount_amount: contractData.custom_pricing.discount_percentage
              ? Math.round(recalculatedTotal * (contractData.custom_pricing.discount_percentage / 100))
              : 0,
            // Preserve payment_plan if it exists, otherwise let useEffect handle it
            payment_plan: contractData.custom_pricing.payment_plan || null
          };

          console.log('ContractPage: Updated pricing with fresh template defaults:', pricingWithVat);
          setCustomPricing(pricingWithVat);

          // Save refreshed pricing tiers to database to persist template defaults
          // Save asynchronously to avoid blocking
          (async () => {
            try {
              const { error } = await supabase
                .from('contracts')
                .update({ custom_pricing: pricingWithVat })
                .eq('id', contractData.id);
              if (error) {
                console.error('ContractPage: Error saving refreshed pricing tiers:', error);
              } else {
                console.log('ContractPage: Successfully saved refreshed pricing tiers to database');
                // Update local contract state to reflect saved pricing
                setContract((prev: any) => ({ ...prev, custom_pricing: pricingWithVat }));
              }
            } catch (err) {
              console.error('ContractPage: Exception saving refreshed pricing tiers:', err);
            }
          })();
        } else {
          console.log('ContractPage: No custom pricing found in contract data, initializing with defaults');

          // Get currency from template (not from lead)
          // Check if we have templateData (which could be from contract_templates or misc_contracttemplate)
          const templateCurrency = templateData?.default_currency || '$';
          const isNIS = templateCurrency === '₪' || templateCurrency === 'ILS' || templateCurrency === 'NIS';
          const initialCurrencyType: 'USD' | 'NIS' = isNIS ? 'NIS' : 'USD';
          let initialSubCurrency: 'USD' | 'GBP' | 'EUR' = 'USD';
          if (!isNIS) {
            if (templateCurrency === '€' || templateCurrency === 'EUR') initialSubCurrency = 'EUR';
            else if (templateCurrency === '£' || templateCurrency === 'GBP') initialSubCurrency = 'GBP';
            else initialSubCurrency = 'USD';
          }

          // Set currency type and sub-currency state
          setCurrencyType(initialCurrencyType);
          if (!isNIS) {
            setSubCurrency(initialSubCurrency);
          }

          // Get pricing tiers from template based on currency type
          // Works for both contract_templates and misc_contracttemplate
          let pricingTiers: { [key: string]: number } = {};

          if (templateData) {
            if (initialCurrencyType === 'NIS' && templateData.default_pricing_tiers_nis) {
              pricingTiers = templateData.default_pricing_tiers_nis;
            } else if (initialCurrencyType === 'USD' && templateData.default_pricing_tiers_usd) {
              pricingTiers = templateData.default_pricing_tiers_usd;
            } else if (templateData.default_pricing_tiers) {
              // Fallback to legacy default_pricing_tiers
              pricingTiers = templateData.default_pricing_tiers;
            }
          }

          // Calculate initial totals from pricing tiers
          const applicantCount = contractData.applicant_count || 1;
          const getCurrentTierKey = (count: number) => {
            if (count === 1) return '1';
            if (count === 2) return '2';
            if (count === 3) return '3';
            if (count >= 4 && count <= 7) return '4-7';
            if (count >= 8 && count <= 9) return '8-9';
            if (count >= 10 && count <= 15) return '10-15';
            return '16+';
          };

          const currentTierKey = getCurrentTierKey(applicantCount);
          const currentPricePerApplicant = pricingTiers[currentTierKey] || 0;
          const total = currentPricePerApplicant * applicantCount;

          // Initialize with default pricing structure using template pricing tiers
          const defaultPricing = {
            applicant_count: applicantCount,
            pricing_tiers: pricingTiers,
            total_amount: total,
            discount_percentage: 0,
            discount_amount: 0,
            final_amount: total,
            payment_plan: [],
            currency: getCurrencySymbol(initialCurrencyType, initialSubCurrency),
            archival_research_fee: 0,
          };
          console.log('ContractPage: Setting default pricing with currency:', defaultPricing);
          setCustomPricing(defaultPricing);
        }

        // Load client inputs if available (for signed contracts)
        if (contractData.client_inputs) {
          console.log('ContractPage: Loading client inputs:', contractData.client_inputs);
          setClientInputs(contractData.client_inputs);
        }

        // If contract is signed, display filled-in content
        if (contractData.signed_at) {
          // Contract is signed, displaying filled-in content
        }

        // Set loading to false after contract is loaded AND template is set
        // For contractId-only routes: if we tried to fetch client, it should be loaded by now (or failed)
        // For leadNumber routes: client is loaded separately in fetchClient useEffect
        // Only set loading to false if we don't need to wait for client, or if client is already loaded
        // Use setTimeout to ensure template state update has been processed before checking for it
        if (leadNumber || clientLoaded || client) {
          setTimeout(() => setLoading(false), 0);
        } else if (!leadNumber && !contractData.client_id) {
          // No client needed, set loading to false
          setTimeout(() => setLoading(false), 0);
        }

      } catch (error) {
        console.error('Error in fetchContract:', error);
        setLoading(false);
      }
    };

    // Fetch contract if we have either leadNumber or contractId
    if (leadNumber || contractId) {
      console.log('ContractPage: Starting fetchContract with:', { leadNumber, contractId });
      fetchContract();
    } else {
      console.log('ContractPage: No leadNumber or contractId, setting loading to false');
      setLoading(false);
    }
  }, [leadNumber, contractId]);

  // Fetch languages when modal opens
  useEffect(() => {
    if (showChangeTemplateModal) {
      const fetchLanguages = async () => {
        try {
          const { data, error } = await supabase
            .from('misc_language')
            .select('id, name')
            .order('name', { ascending: true });

          if (error) throw error;
          setAvailableLanguages(data || []);
        } catch (error) {
          console.error('Error fetching languages:', error);
        }
      };

      fetchLanguages();
    }
  }, [showChangeTemplateModal]);

  // Fetch templates when modal opens
  useEffect(() => {
    if (showChangeTemplateModal) {
      const fetchTemplates = async () => {
        try {
          const [newTemplatesResult, legacyTemplatesResult] = await Promise.all([
            supabase
              .from('contract_templates')
              .select('id, name, content, active, language_id')
              .eq('active', true)
              .order('name', { ascending: true }),
            supabase
              .from('misc_contracttemplate')
              .select('id, name, content, active, language_id')
              .order('name', { ascending: true })
          ]);

          const allTemplates: any[] = [];

          if (newTemplatesResult.data) {
            allTemplates.push(...newTemplatesResult.data.map((t: any) => ({ ...t, id: String(t.id) })));
          }

          if (legacyTemplatesResult.data) {
            const activeLegacy = legacyTemplatesResult.data.filter((t: any) =>
              t.active === true || t.active === 't' || t.active === 1
            );
            allTemplates.push(...activeLegacy.map((t: any) => ({ ...t, id: String(t.id) })));
          }

          setAvailableTemplates(allTemplates);
        } catch (error) {
          console.error('Error fetching templates:', error);
        }
      };

      fetchTemplates();
    }
  }, [showChangeTemplateModal]);

  // Handle template change
  const handleTemplateChange = async (newTemplateId: string) => {
    if (!contract || !contractId) return;

    try {
      // Check if the new template is a legacy template
      const isLegacyTemplate = !isNaN(Number(newTemplateId)) || newTemplateId.startsWith('legacy_');

      // Prepare update data
      const updateData: any = {
        custom_content: null // Clear custom_content so new template content is used
      };

      if (isLegacyTemplate) {
        // For legacy templates, set template_id to NULL and store ID in custom_pricing.legacy_template_id
        updateData.template_id = null;

        // Update custom_pricing to include legacy_template_id
        const currentCustomPricing = contract.custom_pricing || {};
        updateData.custom_pricing = {
          ...currentCustomPricing,
          legacy_template_id: newTemplateId.toString().replace('legacy_', '')
        };
      } else {
        // For new templates (UUID), set template_id to the UUID and remove legacy_template_id
        updateData.template_id = newTemplateId;

        // Remove legacy_template_id from custom_pricing if it exists
        const currentCustomPricing = contract.custom_pricing || {};
        const { legacy_template_id, ...restCustomPricing } = currentCustomPricing;
        updateData.custom_pricing = restCustomPricing;
      }

      // Update contract in database
      console.log('🔄 Updating contract template in database:', { contractId, updateData });
      const { error } = await supabase
        .from('contracts')
        .update(updateData)
        .eq('id', contractId);

      if (error) {
        console.error('❌ Error updating contract template:', error);
        throw error;
      }
      console.log('✅ Contract template updated successfully in database');

      // Fetch updated contract with template
      const { data: updatedContractData, error: fetchError } = await supabase
        .from('contracts')
        .select('*, contract_templates(*)')
        .eq('id', contractId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching updated contract:', fetchError);
        throw fetchError;
      }
      console.log('✅ Fetched updated contract:', {
        template_id: updatedContractData.template_id,
        legacy_template_id: updatedContractData.custom_pricing?.legacy_template_id,
        has_custom_content: !!updatedContractData.custom_content
      });

      // Fetch new template
      const newTemplate = availableTemplates.find(t => t.id === newTemplateId);
      if (newTemplate) {
        // Fetch full template content
        let fullTemplate;

        if (isLegacyTemplate) {
          const templateId = newTemplateId.toString().replace('legacy_', '');
          const { data } = await supabase
            .from('misc_contracttemplate')
            .select('*')
            .eq('id', templateId)
            .single();
          fullTemplate = data;
        } else {
          const { data } = await supabase
            .from('contract_templates')
            .select('*')
            .eq('id', newTemplateId)
            .single();
          fullTemplate = data;
        }

        if (fullTemplate) {
          // Process template to add IDs to placeholders
          let normalizedContent = normalizeTiptapContent(fullTemplate.content);
          const processedContent = normalizedContent && normalizedContent.type === 'doc' ?
            preprocessTemplatePlaceholders(normalizedContent) :
            normalizedContent;

          const processedTemplate = {
            ...fullTemplate,
            content: processedContent
          };

          setTemplate(processedTemplate);

          // Update contract state - clear custom_content so new template content is used
          // Also update the contract with the new template_id/legacy_template_id
          const updatedContract = {
            ...updatedContractData,
            custom_content: null // Clear custom_content to use new template
          };
          setContract(updatedContract);

          // Update editor content
          if (editor && processedTemplate.content) {
            try {
              editor.commands.setContent(processedTemplate.content);
            } catch (error) {
              console.error('❌ Error setting editor content after template change:', error);
              editor.commands.setContent({ type: 'doc', content: [] });
            }
          }

          // Force re-render
          setRenderKey(prev => prev + 1);
        }
      } else {
        // If template not found, still update contract state
        setContract(updatedContractData);
      }

      setShowChangeTemplateModal(false);
      setTemplateSearchQuery('');
      setTemplateLanguageFilter(null);
    } catch (error) {
      console.error('Error changing template:', error);
      alert('Failed to change template');
    }
  };

  // Set loading to false when both contract and client are loaded (for contractId-only routes)
  useEffect(() => {
    if (contract && !leadNumber) {
      // For contractId-only routes, we need both contract and client before setting loading to false
      if (client || !contract.client_id) {
        // Client is loaded, or contract doesn't require a client
        if (loading) {
          console.log('ContractPage: Contract and client ready, setting loading to false');
          setLoading(false);
        }
      }
    } else if (contract && leadNumber && client) {
      // For leadNumber routes, both contract and client are loaded
      if (loading) {
        console.log('ContractPage: Contract and client ready (leadNumber route), setting loading to false');
        setLoading(false);
      }
    }
  }, [contract, client, leadNumber, loading]);

  // Auto-refresh signed contracts to ensure we have the latest filled-in content
  useEffect(() => {
    if (contract && contract.status === 'signed' && !loading) {
      // Only refresh once when the contract is first loaded as signed
      const timer = setTimeout(() => {
        handleRefreshContract();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [contract?.id]); // Only depend on contract ID, not status or loading

  // Update editor content when switching between edit/view modes
  useEffect(() => {
    if (!editor || !contract || !template) return;

    // Always prefer custom_content if it exists (preserves user edits in both edit and view mode)
    // Otherwise use template.content to ensure we have placeholders to replace
    // When pricing changes, we'll still update placeholders in the current content
    // IMPORTANT: Preprocess custom_content to ensure all {{text}} and {{signature}} have IDs
    let content = contract.custom_content || template.content;

    // If using custom_content, ensure it's preprocessed to add IDs to placeholders
    if (contract.custom_content) {
      // Check if content has generic placeholders without IDs
      const contentStr = JSON.stringify(content);
      const hasGenericText = /\{\{text\}\}/.test(contentStr);
      const hasGenericSig = /\{\{signature\}\}/.test(contentStr);

      if (hasGenericText || hasGenericSig) {
        console.log('🔧 Custom content has generic placeholders, preprocessing...');
        content = preprocessTemplatePlaceholders(content);
      }
    }

    if (!content) return;

    // Create a hash of the content and dependencies to detect actual changes
    // Only include fields that affect the processed content
    const contentHash = JSON.stringify({
      contentSource: contract.custom_content ? JSON.stringify(contract.custom_content) : JSON.stringify(template.content),
      customPricingHash: customPricing ? JSON.stringify({
        applicant_count: customPricing.applicant_count,
        total_amount: customPricing.total_amount,
        final_amount: customPricing.final_amount,
        discount_percentage: customPricing.discount_percentage,
        discount_amount: customPricing.discount_amount,
        currency: customPricing.currency,
        pricing_tiers: customPricing.pricing_tiers,
        payment_plan: customPricing.payment_plan,
      }) : null,
      clientHash: client ? JSON.stringify({
        name: client.name,
        email: client.email,
        phone: client.phone,
        mobile: client.mobile,
      }) : null,
      contractHash: contract ? JSON.stringify({
        contact_name: contract.contact_name,
        contact_email: contract.contact_email,
        contact_phone: contract.contact_phone,
        contact_mobile: contract.contact_mobile,
      }) : null,
      editing,
      renderKey,
    });

    // Only update if content hash changed or editing state changed
    const contentChanged = lastContentHashRef.current !== contentHash;
    const editingChanged = lastEditingStateRef.current !== editing;

    // If we're in edit mode and content hasn't changed, don't update (preserve user edits)
    // BUT: if customPricing changed, we should update placeholders even in edit mode
    let pricingChanged = false;
    if (customPricing && lastContentHashRef.current) {
      try {
        const lastHash = JSON.parse(lastContentHashRef.current);
        const currentPricingHash = JSON.stringify({
          applicant_count: customPricing.applicant_count,
          total_amount: customPricing.total_amount,
          final_amount: customPricing.final_amount,
          discount_percentage: customPricing.discount_percentage,
          discount_amount: customPricing.discount_amount,
          currency: customPricing.currency,
          pricing_tiers: customPricing.pricing_tiers,
          payment_plan: customPricing.payment_plan,
        });
        pricingChanged = lastHash.customPricingHash !== currentPricingHash;
      } catch (e) {
        // If parsing fails, assume pricing changed
        pricingChanged = true;
      }
    }

    // In readonly mode, always update when pricing changes (including payment plan)
    // In edit mode, only update if pricing changed (to update placeholders) or content changed
    if (editing && !contentChanged && !pricingChanged) {
      // Only update editability if it changed
      if (editingChanged) {
        editor.setEditable(editing);
        lastEditingStateRef.current = editing;
      }
      return;
    }

    // If content hasn't changed and editing state hasn't changed and pricing hasn't changed, skip update
    // BUT: if pricing changed (including payment plan), we need to update even if content source didn't change
    if (!contentChanged && !editingChanged && !pricingChanged) {
      return;
    }

    console.log('🎯 Editor content effect triggered:', { editing, contentChanged, editingChanged });

    // Process the content
    let processedContent = normalizeTiptapContent(content);
    processedContent = JSON.parse(JSON.stringify(processedContent)); // Deep clone

    if (customPricing && client) {
      // Replace pricing and other placeholders but keep {{text}} and {{signature}} for the custom renderer
      processedContent = fillPlaceholdersInTiptapContent(processedContent, customPricing, client, contract, editing, { current: 0 });
    }

    // Clean up any empty nodes
    processedContent = cleanTiptapContent(processedContent);

    // Final validation before setting content
    if (!processedContent || processedContent.type !== 'doc') {
      console.error('❌ Invalid content after processing, resetting to empty doc. Content:', processedContent);
      processedContent = { type: 'doc', content: [] };
    }

    // Set content if it changed OR if pricing changed (including payment plan)
    // Always update when pricing changes to update placeholders, even in edit mode
    // This ensures payment plan rows update automatically when changed in the side panel
    if (contentChanged || pricingChanged) {
      console.log('🎯 Setting processed content:', { contentChanged, pricingChanged, editing, hasCustomContent: !!contract.custom_content });
      try {
        editor.commands.setContent(processedContent);
        lastContentHashRef.current = contentHash;
      } catch (error) {
        console.error('❌ Error setting editor content:', error);
        console.error('❌ Content that failed:', processedContent);
        editor.commands.setContent({ type: 'doc', content: [] });
        lastContentHashRef.current = JSON.stringify({ content: 'empty' });
      }
    }

    // Set editability
    editor.setEditable(editing);
    lastEditingStateRef.current = editing;
  }, [editing, editor, contract, template, customPricing, client, renderKey]);

  // No need to track editor updates - let TipTap handle it naturally

  // Save handler for edited contract
  const handleSaveEdit = async () => {
    if (!editor || !contract) return;
    const content = editor.getJSON();

    // Debug: Log the content structure to verify paragraphs are present
    console.log('💾 Saving content:', JSON.stringify(content, null, 2));
    const paragraphCount = content?.content?.filter((node: any) => node.type === 'paragraph').length || 0;
    console.log(`📝 Paragraph count in saved content: ${paragraphCount}`);

    // Update contract in database
    const { error } = await supabase
      .from('contracts')
      .update({ custom_content: content })
      .eq('id', contract.id);

    if (error) {
      console.error('Error saving contract:', error);
      return;
    }

    // Update local contract state to reflect saved content
    setContract((prev: any) => prev ? { ...prev, custom_content: content } : prev);
    setEditing(false);

    // Force re-render to show saved content
    setRenderKey(prev => prev + 1);
  };

  // Update contract.custom_pricing in DB and local state, and refresh contract content
  const updateCustomPricing = useCallback(async (updates: any) => {
    if (!contract) {
      console.error('updateCustomPricing: No contract available');
      return;
    }

    // Compute new pricing first
    setCustomPricing((currentPricing: any) => {
      const newPricing = { ...currentPricing, ...updates };

      // If payment_plan is being updated, ensure it's properly formatted
      if (updates.payment_plan) {
        newPricing.payment_plan = updates.payment_plan.map((row: any, index: number) => ({
          ...row,
          payment_order: row.payment_order || row.due_date || (row.label || `Payment ${index + 1}`),
          notes: row.notes || '',
        }));
      }

      // Save to database immediately with the computed value
      const updatePayload: any = {
        custom_pricing: newPricing,
        total_amount: newPricing.total_amount,
        applicant_count: newPricing.applicant_count,
      };

      console.log('💾 Saving payment plan to database:', updatePayload.custom_pricing?.payment_plan);

      // Perform async database update outside of state setter
      (async () => {
        try {
          const { error } = await supabase.from('contracts').update(updatePayload).eq('id', contract.id);
          if (error) {
            console.error('❌ Error updating custom_pricing in database:', error);
            console.error('❌ Failed payload:', JSON.stringify(updatePayload, null, 2));
            alert('Failed to save payment plan changes. Please try again.');
          } else {
            console.log('✅ Successfully saved custom_pricing to database');
            console.log('✅ Payment plan saved:', JSON.stringify(newPricing.payment_plan, null, 2));
            // Update contract state to reflect the saved data
            setContract((prev: any) => ({ ...prev, custom_pricing: newPricing }));
          }
        } catch (err: any) {
          console.error('❌ Exception while updating custom_pricing:', err);
          alert('Failed to save payment plan changes. Please try again.');
        }
      })();

      return newPricing;
    });

    setRenderKey(prev => prev + 1); // Force re-render of readonly view

    // Force editor content refresh when payment plan changes
    // Reset content hash to ensure useEffect detects the change
    if (updates.payment_plan) {
      lastContentHashRef.current = '';
    }
  }, [contract]);

  // Ensure applicant_count is at least 1 after loading contract/customPricing
  useEffect(() => {
    if (customPricing && (!customPricing.applicant_count || customPricing.applicant_count < 1)) {
      const updated = { ...customPricing, applicant_count: 1 };
      setCustomPricing(updated);
      if (contract) {
        supabase.from('contracts').update({ custom_pricing: updated }).eq('id', contract.id);
      }
    }
    // Ensure payment_plan is initialized
    if (customPricing && (!customPricing.payment_plan || customPricing.payment_plan.length === 0)) {
      const finalAmount = customPricing.final_amount || 0;
      const defaultPlan = [
        { percent: 50, due_date: 'On signing', value: Math.round(finalAmount * 0.5) },
        { percent: 25, due_date: '30 days', value: Math.round(finalAmount * 0.25) },
        { percent: 25, due_date: '60 days', value: Math.round(finalAmount * 0.25) },
      ];
      const updated = { ...customPricing, payment_plan: defaultPlan };
      setCustomPricing(updated);
      if (contract) {
        supabase.from('contracts').update({ custom_pricing: updated }).eq('id', contract.id);
      }
    }
  }, [customPricing, contract]);

  // Ensure total_amount and pricing fields are always saved to DB after customPricing is initialized
  useEffect(() => {
    if (!contract || !customPricing) return;
    const dbTotal = contract.custom_pricing?.total_amount;
    const localTotal = customPricing.total_amount;
    if (typeof localTotal === 'number' && localTotal > 0 && localTotal !== dbTotal) {
      supabase.from('contracts').update({ custom_pricing: customPricing }).eq('id', contract.id);
    }
  }, [contract, customPricing]);

  // When initializing or updating customPricing, use buildPaymentPlan with VAT calculations
  useEffect(() => {
    if (!customPricing) return;

    const archivalFee = customPricing.archival_research_fee || 0;
    const totalAmount = customPricing.total_amount || 0;
    const discountAmount = customPricing?.discount_amount || 0;
    const currency = customPricing?.currency || '₪';
    const isIsraeli = currency === '₪' || currency === 'ILS' || currency === 'NIS';

    // Always recalculate payment plan when final amount changes
    // This ensures payment plan amounts update automatically when total_amount, discount, or currency changes
    const currentPaymentPlan = customPricing.payment_plan || [];

    // Calculate the discounted base total (for payment plan calculations)
    const discountedBaseTotal = totalAmount - discountAmount;

    // If payment plan exists, recalculate amounts based on percentages
    // Otherwise, build a new payment plan structure
    let basicPaymentPlan;
    if (currentPaymentPlan.length > 0) {
      // Use existing payment plan structure but recalculate amounts
      basicPaymentPlan = currentPaymentPlan.map((row: any) => ({
        percent: row.percent || row.due_percent || 0,
        due_date: row.due_date || null,
        label: row.label || row.payment_order || 'Payment',
        payment_order: row.payment_order || row.label || 'Payment',
        notes: row.notes || '',
      }));
    } else {
      // Build new payment plan structure
      basicPaymentPlan = buildPaymentPlan(totalAmount, archivalFee);
    }

    // Calculate total percentage to ensure proper distribution
    const totalPercent = basicPaymentPlan.reduce((sum: number, p: any) => sum + Number(p.percent || 0), 0) || 100;

    // Update each payment to show value + VAT only if there's VAT
    const paymentPlan = basicPaymentPlan.map((payment: any, idx: number) => {
      if (payment.label === 'Archival Research' || payment.payment_order === 'Archival Research') {
        // Archival fee is separate and doesn't get recalculated
        return {
          ...payment,
          value: archivalFee.toString(),
          payment_order: payment.payment_order || payment.label || 'Archival Research',
          notes: payment.notes || '',
        };
      } else {
        // Calculate the base value for this percentage based on discounted total
        // Use the percentage ratio to distribute the discounted amount
        const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(payment.percent || 0)) / totalPercent);
        const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;

        // Ensure last payment is marked as "Final Payment"
        const isLastPayment = idx === basicPaymentPlan.length - 1;
        const paymentOrder = isLastPayment ? 'Final Payment' : (payment.payment_order || payment.label || payment.due_date || 'Payment');

        return {
          ...payment,
          percent: payment.percent || 0,
          value: (vatIncluded && isIsraeli && vatForThisPercent > 0) ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
          payment_order: paymentOrder,
          notes: payment.notes || '',
        };
      }
    });

    // Always update the payment plan to ensure VAT is applied
    setCustomPricing((prev: typeof customPricing) => ({ ...prev, payment_plan: paymentPlan }));
  }, [customPricing?.total_amount, customPricing?.discount_amount, customPricing?.archival_research_fee, contract?.client_country, customPricing?.currency, customPricing?._forceVatCalculation, vatIncluded, currencyType]);

  // Force VAT calculation on initial load
  useEffect(() => {
    if (!customPricing || !customPricing.payment_plan) return;

    const currency = customPricing?.currency || '₪';
    const isIsraeli = currency === '₪' || currency === 'ILS' || currency === 'NIS';
    const currentPaymentPlan = customPricing.payment_plan;

    // Check if payment plan needs VAT calculation (has numeric values instead of "value + VAT" strings)
    const needsVatCalculation = currentPaymentPlan.some((row: any) =>
      typeof row.value === 'number' || (typeof row.value === 'string' && !row.value.includes('+'))
    );

    if (needsVatCalculation && isIsraeli) {
      console.log('🔧 Forcing VAT calculation on initial load');
      // Trigger the main VAT calculation by updating a dependency
      setCustomPricing((prev: typeof customPricing) => ({
        ...prev,
        _forceVatCalculation: Date.now()
      }));
    }
  }, [customPricing?.payment_plan, customPricing?.currency]);

  // Discount options
  const discountOptions = [0, 5, 10, 15, 20];

  // Helper function to get tier key based on applicant count
  const getCurrentTierKey = (count: number) => {
    if (count === 1) return '1';
    if (count === 2) return '2';
    if (count === 3) return '3';
    if (count >= 4 && count <= 7) return '4-7';
    if (count >= 8 && count <= 9) return '8-9';
    if (count >= 10 && count <= 15) return '10-15';
    return '16+';
  };

  // Update applicant count and recalculate pricing
  const handleApplicantCountChange = (newCount: number) => {
    if (!customPricing || !customPricing.pricing_tiers) return;

    // Get the correct tier for this applicant count
    const tierKey = getCurrentTierKey(newCount);
    const pricePerApplicant = customPricing.pricing_tiers[tierKey] || 0;
    const total = pricePerApplicant * newCount;
    const discount = Number(customPricing.discount_percentage) || 0;
    const discountAmount = Math.round(total * (discount / 100));
    const finalAmount = total - discountAmount;

    // Calculate final amount with VAT for payment plan calculations
    const archivalFee = customPricing?.archival_research_fee || 0;
    const baseTotal = total + archivalFee;
    const currency = customPricing?.currency || '₪';
    const isIsraeli = currency === '₪' || currency === 'ILS' || currency === 'NIS';

    // Calculate VAT on the discounted amount (baseTotal - discountAmount)
    const discountedBaseTotal = baseTotal - discountAmount;
    const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;
    const finalAmountWithVat = discountedBaseTotal + vatAmount;

    // Recalculate payment plan amounts - each payment should show "value + VAT" only if there's VAT
    let paymentPlan = customPricing.payment_plan || [];
    if (paymentPlan.length > 0) {
      const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
      paymentPlan = paymentPlan.map((row: any) => {
        // Calculate the base value for this percentage (based on discounted amount)
        const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
        // Calculate the VAT for this percentage
        const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
        // The amount field should show "value + VAT" format only if there's VAT, otherwise just the value
        return {
          ...row,
          value: isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
        };
      });
    }

    updateCustomPricing({
      applicant_count: newCount,
      total_amount: total,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      payment_plan: paymentPlan,
    });
  };

  // Update price for a specific tier
  const handleTierPriceChange = (tierKey: string, newPrice: number) => {
    if (!customPricing || !customPricing.pricing_tiers) return;

    const newPricingTiers: { [key: string]: number } = {
      ...customPricing.pricing_tiers,
      [tierKey]: newPrice
    };

    // Check if this tier affects the current applicant count
    const currentTierKey = getCurrentTierKey(customPricing.applicant_count);
    if (tierKey === currentTierKey) {
      const total = newPrice * customPricing.applicant_count;
      const discount = Number(customPricing.discount_percentage) || 0;
      const discountAmount = Math.round(total * (discount / 100));
      const finalAmount = total - discountAmount;

      // Calculate final amount with VAT for payment plan calculations
      const archivalFee = customPricing?.archival_research_fee || 0;
      const baseTotal = total + archivalFee;
      const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';

      // Calculate VAT on the discounted amount (baseTotal - discountAmount)
      const discountedBaseTotal = baseTotal - discountAmount;
      const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;
      const finalAmountWithVat = discountedBaseTotal + vatAmount;

      // Recalculate payment plan amounts - each payment should show "value + VAT" only if there's VAT
      let paymentPlan = customPricing.payment_plan || [];
      if (paymentPlan.length > 0) {
        const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
        paymentPlan = paymentPlan.map((row: any) => {
          // Calculate the base value for this percentage (based on discounted amount)
          const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
          // Calculate the VAT for this percentage
          const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
          // The amount field should show "value + VAT" format only if there's VAT, otherwise just the value
          return {
            ...row,
            value: isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
          };
        });
      }

      updateCustomPricing({
        pricing_tiers: newPricingTiers,
        total_amount: total,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        payment_plan: paymentPlan,
      });
    } else {
      updateCustomPricing({
        pricing_tiers: newPricingTiers,
      });
    }
  };

  // Payment plan editor helpers
  const handlePaymentPlanChange = (idx: number, field: string, value: any) => {
    const newPlan = [...(customPricing.payment_plan || [])];
    newPlan[idx] = { ...newPlan[idx], [field]: value };

    // Calculate the correct final amount including VAT
    const archivalFee = customPricing?.archival_research_fee || 0;
    const baseTotal = (customPricing?.total_amount || 0) + archivalFee;
    const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';
    const discountAmount = customPricing?.discount_amount || 0;

    // Calculate VAT on the discounted amount (baseTotal - discountAmount)
    const discountedBaseTotal = baseTotal - discountAmount;
    const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;
    const finalAmountWithVat = discountedBaseTotal + vatAmount;

    // If changing value (amount), recalculate percentage
    if (field === 'value') {
      // Parse the value string to extract the total amount
      let totalValue = 0;
      if (typeof value === 'string' && value.includes('+')) {
        // Extract numbers from "value + vat" format
        const parts = value.split('+').map(part => parseFloat(part.trim()) || 0);
        totalValue = parts.reduce((sum, part) => sum + part, 0);
      } else {
        totalValue = parseFloat(value) || 0;
      }
      newPlan[idx].percent = finalAmountWithVat > 0 ? Math.round((totalValue / finalAmountWithVat) * 100) : 0;
    }
    // If changing percentage, recalculate value (amount) - this should show "value + VAT" only if there's VAT
    else if (field === 'percent') {
      // Calculate the base value for this percentage (based on discounted amount)
      const baseValueForThisPercent = Math.round((discountedBaseTotal * value) / 100);
      // Calculate the VAT for this percentage
      const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
      // The amount field should show "value + VAT" format only if there's VAT, otherwise just the value
      newPlan[idx].value = isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString();
    }

    updateCustomPricing({ payment_plan: newPlan });
  };

  const handleAddPaymentRow = () => {
    const currentPlan = customPricing.payment_plan || [];
    const newPlan = [
      ...currentPlan,
      {
        percent: 0,
        due_date: '',
        value: 0,
        payment_order: `Payment ${currentPlan.length + 1}`,
        notes: '',
        label: `Payment ${currentPlan.length + 1}`,
      },
    ];
    updateCustomPricing({ payment_plan: newPlan });
  };

  const handleDeletePaymentRow = (idx: number) => {
    const newPlan = (customPricing.payment_plan || []).filter((_: any, i: number) => i !== idx);
    updateCustomPricing({ payment_plan: newPlan });
  };

  // Handle contract signing
  const handleSignContract = async () => {
    try {
      // Fetch the latest contract from the DB to get the freshest custom_pricing
      const { data: freshContract, error: fetchError } = await supabase
        .from('contracts')
        .select('*')
        .eq('id', contract.id)
        .single();
      if (fetchError) throw fetchError;
      const latestPricing = freshContract.custom_pricing || {};
      const applicantCount = latestPricing.applicant_count || 1;
      const isIsraeli = freshContract.client_country === 'IL';
      const currency = isIsraeli ? 'NIS' : 'USD';
      const pricingTiers = latestPricing.pricing_tiers || {};
      const getCurrentTierKey = (count: number) => {
        if (count === 1) return '1';
        if (count === 2) return '2';
        if (count === 3) return '3';
        if (count >= 4 && count <= 7) return '4-7';
        if (count >= 8 && count <= 9) return '8-9';
        if (count >= 10 && count <= 15) return '10-15';
        return '16+';
      };
      const currentTierKey = getCurrentTierKey(applicantCount);
      const currentPricePerApplicant = pricingTiers[currentTierKey] || 0;
      const total = currentPricePerApplicant * applicantCount;
      const discount = Number(latestPricing.discount_percentage) || 0;
      const discountAmount = Math.round(total * (discount / 100));
      const finalAmount = total - discountAmount;
      // Debug logging

      if (!applicantCount || applicantCount < 1) {
        alert('Please set the number of applicants before signing.');
        return;
      }
      // Recalculate payment plan amounts and convert "value + VAT" format to separate numeric values
      let updatedPaymentPlan = latestPricing.payment_plan || [];
      if (updatedPaymentPlan.length > 0) {
        const totalPercent = updatedPaymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
        updatedPaymentPlan = updatedPaymentPlan.map((row: any, idx: number) => {
          // Parse the "value + VAT" format to extract separate values
          let value = 0;
          let value_vat = 0;

          if (typeof row.value === 'string' && row.value.includes('+')) {
            // Extract numbers from "value + vat" format
            const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
            value = parts[0] || 0;
            value_vat = parts[1] || 0;
          } else {
            // If it's already a number or doesn't have the format, use as is
            value = parseFloat(row.value) || 0;
            value_vat = 0;
          }

          return {
            ...row,
            value: value,
            value_vat: value_vat,
            amount: value + value_vat, // Keep amount for backward compatibility
            payment_order: row.payment_order || row.due_date || (row.label || `Payment ${idx + 1}`),
            notes: row.notes || '',
            due_date: row.due_date || null,
            percent: row.percent || 0,
          };
        });
      }
      // Update the contract with the rebuilt payment plan and final amount before signing
      // Ensure payment plan has all required fields for contractAutomation
      const formattedPaymentPlan = updatedPaymentPlan.map((row: any, idx: number) => ({
        percent: row.percent || 0,
        due_date: row.due_date || null,
        value: row.value,
        value_vat: row.value_vat || 0,
        payment_order: row.payment_order || row.due_date || (row.label || `Payment ${idx + 1}`),
        notes: row.notes || '',
        label: row.label || row.payment_order || `Payment ${idx + 1}`,
      }));

      await supabase.from('contracts').update({
        custom_pricing: {
          ...latestPricing,
          pricing_tiers: pricingTiers,
          currency,
          total_amount: total,
          discount_amount: discountAmount,
          final_amount: finalAmount,
          payment_plan: formattedPaymentPlan,
        }
      }).eq('id', contract.id);

      // Fill TipTap JSON with clientInputs
      const filledContent = fillTiptapJsonWithInputs(
        contract.custom_content || template.content?.content,
        clientInputs,
        '',
        { text: 0, signature: 0 }
      );
      // Save filled content to DB before marking as signed
      await supabase.from('contracts').update({
        custom_content: filledContent
      }).eq('id', contract.id);

      const { data: updatedContract, error } = await supabase
        .from('contracts')
        .update({
          status: 'signed',
          signed_at: new Date().toISOString()
        })
        .eq('id', contract.id)
        .select()
        .single();

      if (error) throw error;

      // Update the client's balance in the leads table to the contract's final_amount
      if (client && client.id && finalAmount) {
        const { error: balanceError } = await supabase
          .from('leads')
          .update({ balance: finalAmount })
          .eq('id', client.id);
        if (balanceError) {
          console.error('Failed to update client balance:', balanceError);
          alert('Contract signed, but failed to update client balance.');
        }
      }

      await handleContractSigned(updatedContract);
      alert('Contract signed! Payment plan has been automatically generated.');
      navigate(`/clients/${leadNumber}`);

    } catch (error) {
      console.error('Error signing contract:', error);
      alert('Failed to sign contract. Please try again.');
    }
  };

  // Add handler for country change (deprecated - currency now comes from lead)
  const handleCountryChange = async (newCountry: string) => {
    if (!contract) return;
    // Update contract in DB
    await supabase.from('contracts').update({ client_country: newCountry }).eq('id', contract.id);
    // Update local contract state
    setContract((prev: any) => ({ ...prev, client_country: newCountry }));
    // Recalculate pricing tiers and currency - use lead's currency instead
    const currency = customPricing?.currency || '₪';
    const isIsraeli = currency === '₪' || currency === 'ILS' || currency === 'NIS';
    // Rebuild pricing tiers
    const pricingTiers: { [key: string]: number } = {};
    const tierStructure = [
      { key: '1', label: 'For one applicant', count: 1 },
      { key: '2', label: 'For 2 applicants', count: 2 },
      { key: '3', label: 'For 3 applicants', count: 3 },
      { key: '4-7', label: 'For 4-7 applicants', count: 4 },
      { key: '8-9', label: 'For 8-9 applicants', count: 8 },
      { key: '10-15', label: 'For 10-15 applicants', count: 10 },
      { key: '16+', label: 'For 16 applicants or more', count: 16 }
    ];
    tierStructure.forEach(tier => {
      const priceTier = getPricePerApplicant(tier.count, isIsraeli);
      const pricePerApplicant = isIsraeli && 'priceWithVat' in priceTier ? priceTier.priceWithVat : priceTier.price;
      pricingTiers[tier.key] = pricePerApplicant;
    });
    // Recalculate totals
    const applicantCount = customPricing?.applicant_count || 1;
    const currentTierKey = getCurrentTierKey(applicantCount);
    const currentPricePerApplicant = pricingTiers[currentTierKey];
    const total = currentPricePerApplicant * applicantCount;
    const discount = Number(customPricing?.discount_percentage) || 0;
    const discountAmount = Math.round(total * (discount / 100));
    const finalAmount = total - discountAmount;
    // Recalculate payment plan amounts
    let paymentPlan = customPricing?.payment_plan || [];
    if (paymentPlan.length > 0) {
      const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
      paymentPlan = paymentPlan.map((row: any) => ({
        ...row,
        value: Math.round(finalAmount * (Number(row.percent) / totalPercent)),
      }));
    }
    // Update customPricing
    const updatedPricing = {
      ...customPricing,
      pricing_tiers: pricingTiers,
      currency,
      total_amount: total,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      payment_plan: paymentPlan,
    };
    setCustomPricing(updatedPricing);
    setRenderKey(prev => prev + 1); // Force re-render of editor content
    // Save to DB
    await supabase.from('contracts').update({
      custom_pricing: updatedPricing
    }).eq('id', contract.id);
    setContract((prev: any) => ({ ...prev, custom_pricing: updatedPricing }));
  };

  // Helper to render TipTap JSON as React elements, with support for dynamic fields in 'View as Client' mode
  // Helper function to detect RTL text (Hebrew, Arabic)
  const isRTL = (text: string): boolean => {
    if (!text) return false;
    const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return rtlChars.test(text);
  };

  const renderTiptapContent = (
    content: any,
    keyPrefix = '',
    asClient = false,
    signaturePads?: { [key: string]: any },
    applicantPriceIndex?: { current: number },
    paymentPlanIndex?: { current: number },
    isReadOnly = false,
    placeholderIndex?: { text: number; signature: number }
  ): React.ReactNode => {
    if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0 };
    if (!content) return null;
    if (Array.isArray(content)) {
      // Initialize indices if not provided
      if (!applicantPriceIndex) applicantPriceIndex = { current: 0 };
      if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
      // In renderTiptapContent, when recursing into an array, pass the SAME placeholderIndex object to all children (do NOT clone)
      return content.map((n, i) =>
        renderTiptapContent(
          n,
          keyPrefix + '-' + i,
          asClient,
          signaturePads,
          applicantPriceIndex,
          paymentPlanIndex,
          isReadOnly,
          placeholderIndex // DO NOT CLONE
        )
      );
    }
    if (content.type === 'text') {
      let text = content.text;

      // Check for date placeholders first - handle {{date:ID}} before other placeholders
      if (text && /\{\{date:([^}]+)\}\}/.test(text)) {
        const parts = [];
        let lastIndex = 0;
        const dateRegex = /\{\{date:([^}]+)\}\}/g;
        let dateMatch;

        while ((dateMatch = dateRegex.exec(text)) !== null) {
          if (dateMatch.index > lastIndex) {
            const normalText = text.slice(lastIndex, dateMatch.index);
            parts.push(normalText);
          }
          const id = dateMatch[1];
          const dateValue = clientInputs[id] || '';

          parts.push(
            <span
              key={id}
              className="inline-flex items-center relative field-wrapper"
              style={{
                verticalAlign: 'middle',
                margin: '0 8px',
                display: 'inline-flex',
                gap: '4px'
              }}
              data-field-id={id}
              data-field-type="date"
            >
              <input
                type="date"
                className="input input-bordered bg-white border-2 border-blue-300 focus:border-blue-500 rounded-lg"
                value={dateValue ? (() => {
                  // Ensure the value is in YYYY-MM-DD format for date inputs
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                    return dateValue;
                  }
                  try {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime())) {
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      return `${year}-${month}-${day}`;
                    }
                  } catch (e) {
                  }
                  return '';
                })() : ''}
                onChange={e => {
                  const selectedDate = e.target.value;
                  setClientInputs(inputs => ({ ...inputs, [id]: selectedDate }));
                }}
                disabled={isReadOnly}
                required
                aria-label="Select date (required)"
                placeholder=""
                readOnly={false}
                autoComplete="off"
                data-input-type="date"
                style={{
                  minWidth: 200,
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '16px',
                  lineHeight: '1.5',
                  margin: 0,
                  color: '#111827',
                  WebkitTextFillColor: '#111827',
                  cursor: isReadOnly ? 'not-allowed' : 'pointer',
                  appearance: 'auto',
                  WebkitAppearance: 'menulist',
                  MozAppearance: 'menulist'
                }}
              />
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (editor) {
                      const content = editor.getJSON();
                      const removePlaceholder = (node: any): any => {
                        if (node.type === 'text' && node.text) {
                          const newText = node.text.replace(new RegExp(`\\{\\{date:${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g'), '');
                          if (newText !== node.text) {
                            return newText ? { ...node, text: newText } : null;
                          }
                        }
                        if (node.content) {
                          const processedContent = Array.isArray(node.content)
                            ? node.content.map(removePlaceholder).filter(Boolean)
                            : removePlaceholder(node.content);
                          return { ...node, content: processedContent };
                        }
                        return node;
                      };
                      const newContent = removePlaceholder(content);
                      editor.commands.setContent(newContent);
                    }
                    setClientInputs(inputs => {
                      const newInputs = { ...inputs };
                      delete newInputs[id];
                      return newInputs;
                    });
                  }}
                  className="btn btn-circle btn-xs btn-error"
                  style={{
                    width: '20px',
                    height: '20px',
                    minHeight: '20px',
                    padding: 0,
                    flexShrink: 0
                  }}
                  title="Delete field"
                >
                  <MinusIcon className="w-3 h-3" />
                </button>
              )}
            </span>
          );
          lastIndex = dateRegex.lastIndex;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }

        // After handling date placeholders, process the rest of the text normally
        // But first, let's recursively process any remaining placeholders
        return parts.map((part, idx) => {
          if (typeof part === 'string' && (part.includes('{{text}}') || part.includes('{{signature}}') || part.includes('{{'))) {
            // If this part still has other placeholders, process it through the normal flow
            // We'll handle this by creating a temporary text node
            const tempContent = { type: 'text', text: part };
            return <React.Fragment key={keyPrefix + '-date-part-' + idx}>
              {renderTiptapContent(tempContent, keyPrefix + '-date-' + idx, asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}
            </React.Fragment>;
          }
          return part;
        });
      }

      // First, handle payment plan row placeholders - MUST be before text:ID processing to avoid early return
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
        let result: (string | JSX.Element)[] = [];
        let lastIdx = 0;
        let match;
        const regex = /\{\{payment_plan_row\}\}/g;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIdx) {
            result.push(text.slice(lastIdx, match.index));
          }
          const rowIndex = paymentPlanIndex.current;
          const row = customPricing.payment_plan[rowIndex];
          paymentPlanIndex.current++;
          if (row) {
            // Handle the new value format "value + VAT" or just "value"
            let displayValue = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Parse "value + VAT" format
                const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
                const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
                displayValue = totalValue.toLocaleString();
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValue = numValue.toLocaleString();
              }
            }

            // Use the exact same value format as shown in the payment plan panel
            let displayValueStr = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Keep the "value + VAT" format exactly as it appears in the panel
                displayValueStr = row.value;
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValueStr = numValue.toString();
              }
            }

            result.push(
              <span className="inline-block text-black font-medium border-b-2 border-black" key={keyPrefix + '-pprow-' + rowIndex}>
                {row.percent}% = {customPricing.currency} {displayValueStr}
              </span>
            );
          } else {
            result.push('');
          }
          lastIdx = match.index + match[0].length;
        }
        if (lastIdx < text.length) {
          result.push(text.slice(lastIdx));
        }
        // Recursively process any remaining placeholders in the result
        if (result.length > 0) {
          const processedResult = result.map((part, idx) => {
            if (typeof part === 'string' && (part.includes('{{text') || part.includes('{{date') || part.includes('{{signature'))) {
              // Process remaining placeholders in this text part
              const tempContent = { type: 'text', text: part };
              return renderTiptapContent(tempContent, keyPrefix + '-pprow-' + idx, asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex);
            }
            return part;
          });
          // Flatten the result in case recursive calls return arrays
          return processedResult.flat().filter(item => item !== null && item !== undefined);
        }
      }

      // Now handle {{text:ID}}, {{date:ID}}, and {{signature:ID}} placeholders (with IDs)
      // Check specifically for placeholders WITH IDs (the :ID part is required)
      if (text && /\{\{(text|date|signature):[^}]+\}\}/.test(text)) {
        const parts = [];
        let lastIndex = 0;
        // Match ONLY placeholders with IDs (require the :ID part)
        const regex = /({{text:[^}]+}}|{{date:[^}]+}}|{{signature:[^}]+}}|\n)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const placeholder = match[1];

          // Parse the placeholder - all these have IDs
          const textMatch = placeholder.match(/^{{text:([^}]+)}}$/);
          const dateMatch = placeholder.match(/^{{date:([^}]+)}}$/);
          const sigMatch = placeholder.match(/^{{signature:([^}]+)}}$/);

          // Handle date fields first
          if (dateMatch) {
            const baseId = dateMatch[1];
            const dateValue = clientInputs[baseId] || '';

            const fieldPosition = fieldPositions[baseId] || { x: 0, y: 0 };
            parts.push(
              <span
                key={baseId}
                draggable={!isReadOnly && editing}
                onDragStart={(e) => {
                  if (!isReadOnly && editing) {
                    setDraggingFieldId(baseId);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', baseId);
                    const rect = e.currentTarget.getBoundingClientRect();
                    e.dataTransfer.setData('application/x-offset', `${e.clientX - rect.left},${e.clientY - rect.top}`);
                    e.currentTarget.style.opacity = '0.5';
                  }
                }}
                onDrag={(e) => {
                  if (!isReadOnly && editing && draggingFieldId === baseId && e.clientX > 0 && e.clientY > 0) {
                    const offset = e.dataTransfer.getData('application/x-offset');
                    if (offset) {
                      const [offsetX, offsetY] = offset.split(',').map(Number);
                      const newX = e.clientX - offsetX;
                      const newY = e.clientY - offsetY;
                      setFieldPositions(prev => ({
                        ...prev,
                        [baseId]: { x: newX, y: newY }
                      }));
                    }
                  }
                }}
                onDragEnd={(e) => {
                  setDraggingFieldId(null);
                  e.currentTarget.style.opacity = '1';
                }}
                onDragOver={(e) => {
                  if (!isReadOnly && editing) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(e) => {
                  if (!isReadOnly && editing) {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (draggedId && draggedId !== baseId) {
                      // Swap positions
                      const draggedPos = fieldPositions[draggedId] || { x: 0, y: 0 };
                      const currentPos = fieldPositions[baseId] || { x: 0, y: 0 };
                      setFieldPositions(prev => ({
                        ...prev,
                        [draggedId]: currentPos,
                        [baseId]: draggedPos
                      }));
                    }
                  }
                }}
                className="inline-flex items-center relative field-wrapper"
                style={{
                  verticalAlign: 'middle',
                  margin: '0 8px',
                  display: 'inline-flex',
                  gap: '4px',
                  position: editing && !isReadOnly ? 'absolute' : 'relative',
                  left: editing && !isReadOnly && fieldPosition.x ? `${fieldPosition.x}px` : 'auto',
                  top: editing && !isReadOnly && fieldPosition.y ? `${fieldPosition.y}px` : 'auto',
                  cursor: editing && !isReadOnly ? 'move' : 'default',
                  zIndex: editing && !isReadOnly ? 1000 : 'auto'
                }}
                data-field-id={baseId}
                data-field-type="date"
              >
                <input
                  type="date"
                  className="input input-bordered bg-white border-2 border-blue-300 focus:border-blue-500 rounded-lg"
                  value={dateValue ? (() => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                      return dateValue;
                    }
                    try {
                      const date = new Date(dateValue);
                      if (!isNaN(date.getTime())) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        return `${year}-${month}-${day}`;
                      }
                    } catch (e) {
                    }
                    return '';
                  })() : ''}
                  onChange={e => {
                    const selectedDate = e.target.value;
                    setClientInputs(inputs => ({ ...inputs, [baseId]: selectedDate }));
                  }}
                  disabled={isReadOnly}
                  required
                  aria-label="Select date (required)"
                  placeholder=""
                  readOnly={false}
                  autoComplete="off"
                  data-input-type="date"
                  style={{
                    minWidth: 200,
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '16px',
                    lineHeight: '1.5',
                    margin: 0,
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    cursor: isReadOnly ? 'not-allowed' : 'pointer',
                    appearance: 'auto',
                    WebkitAppearance: 'menulist',
                    MozAppearance: 'menulist'
                  }}
                />
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (editor) {
                        const content = editor.getJSON();
                        const removePlaceholder = (node: any): any => {
                          if (node.type === 'text' && node.text) {
                            const newText = node.text.replace(new RegExp(`\\{\\{date:${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g'), '');
                            if (newText !== node.text) {
                              return newText ? { ...node, text: newText } : null;
                            }
                          }
                          if (node.content) {
                            const processedContent = Array.isArray(node.content)
                              ? node.content.map(removePlaceholder).filter(Boolean)
                              : removePlaceholder(node.content);
                            return { ...node, content: processedContent };
                          }
                          return node;
                        };
                        const newContent = removePlaceholder(content);
                        editor.commands.setContent(newContent);
                      }
                      setClientInputs(inputs => {
                        const newInputs = { ...inputs };
                        delete newInputs[baseId];
                        return newInputs;
                      });
                    }}
                    className="btn btn-circle btn-xs btn-error"
                    style={{
                      width: '20px',
                      height: '20px',
                      minHeight: '20px',
                      padding: 0,
                      flexShrink: 0
                    }}
                    title="Delete field"
                  >
                    <MinusIcon className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
            lastIndex = match.index + match[1].length;
            continue;
          }

          // Handle text fields with IDs
          if (textMatch) {
            // Extract base ID from placeholder (e.g., "applicant" from "{{text:applicant}}")
            const baseId = textMatch[1];
            const baseIdLower = baseId.toLowerCase();

            // Check if this is an applicant field
            const isApplicantField = baseIdLower.startsWith('text:applicant') ||
              baseIdLower.startsWith('applicant') ||
              baseIdLower.includes('applicant');

            // For applicant fields, create unique instance ID to prevent state sharing
            // Use match.index + keyPrefix for stable, unique IDs across renders
            let id: string;
            if (isApplicantField) {
              const uniqueKey = `${keyPrefix}-${match.index}`.replace(/[^a-zA-Z0-9-]/g, '-');
              id = `${baseId}-${uniqueKey}`;
            } else {
              id = baseId;
            }

            const textFieldPosition = fieldPositions[id] || { x: 0, y: 0 };

            parts.push(
              <span
                key={id}
                draggable={!isReadOnly && editing}
                onDragStart={(e) => {
                  if (!isReadOnly && editing) {
                    setDraggingFieldId(id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', id);
                    const rect = e.currentTarget.getBoundingClientRect();
                    e.dataTransfer.setData('application/x-offset', `${e.clientX - rect.left},${e.clientY - rect.top}`);
                    e.currentTarget.style.opacity = '0.5';
                  }
                }}
                onDrag={(e) => {
                  if (!isReadOnly && editing && draggingFieldId === id && e.clientX > 0 && e.clientY > 0) {
                    const offset = e.dataTransfer.getData('application/x-offset');
                    if (offset) {
                      const [offsetX, offsetY] = offset.split(',').map(Number);
                      const newX = e.clientX - offsetX;
                      const newY = e.clientY - offsetY;
                      setFieldPositions(prev => ({
                        ...prev,
                        [id]: { x: newX, y: newY }
                      }));
                    }
                  }
                }}
                onDragEnd={(e) => {
                  setDraggingFieldId(null);
                  e.currentTarget.style.opacity = '1';
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  margin: '0 8px',
                  verticalAlign: 'middle',
                  position: editing && !isReadOnly ? 'absolute' : 'relative',
                  left: editing && !isReadOnly && textFieldPosition.x ? `${textFieldPosition.x}px` : 'auto',
                  top: editing && !isReadOnly && textFieldPosition.y ? `${textFieldPosition.y}px` : 'auto',
                  gap: '4px',
                  cursor: editing && !isReadOnly ? 'move' : 'default',
                  zIndex: editing && !isReadOnly ? 1000 : 'auto'
                }}
              >
                <input
                  className="input input-bordered bg-white border-2 border-blue-300 focus:border-blue-500 rounded-lg"
                  placeholder={isApplicantField ? 'Enter applicant name' : 'Enter text'}
                  style={{
                    minWidth: 200,
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '16px',
                    lineHeight: '1.5',
                    margin: 0
                  }}
                  value={clientInputs[id] || ''}
                  onChange={e => setClientInputs(inputs => ({ ...inputs, [id]: e.target.value }))}
                  disabled={isReadOnly}
                />
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Remove the placeholder from the editor content
                      if (editor) {
                        const content = editor.getJSON();
                        const removePlaceholder = (node: any): any => {
                          if (node.type === 'text' && node.text) {
                            const newText = node.text.replace(new RegExp(`\\{\\{text:${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g'), '');
                            if (newText !== node.text) {
                              return newText ? { ...node, text: newText } : null;
                            }
                          }
                          if (node.content) {
                            const processedContent = Array.isArray(node.content)
                              ? node.content.map(removePlaceholder).filter(Boolean)
                              : removePlaceholder(node.content);
                            return { ...node, content: processedContent };
                          }
                          return node;
                        };
                        const newContent = removePlaceholder(content);
                        editor.commands.setContent(newContent);
                      }
                      // Remove from clientInputs
                      setClientInputs(inputs => {
                        const newInputs = { ...inputs };
                        delete newInputs[id];
                        return newInputs;
                      });
                    }}
                    className="btn btn-circle btn-xs btn-error"
                    style={{
                      width: '20px',
                      height: '20px',
                      minHeight: '20px',
                      padding: 0,
                      flexShrink: 0
                    }}
                    title="Delete field"
                  >
                    <MinusIcon className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
            lastIndex = match.index + match[1].length;
            continue;
          }

          // Handle signature fields with IDs
          if (sigMatch) {
            const baseId = sigMatch[1];
            const signatureData = clientInputs[baseId];

            if (signatureData && signatureData.startsWith('data:image/')) {
              parts.push(
                <span key={baseId} className="inline-flex items-center gap-4 mx-2">
                  <span className="inline-block">
                    <img
                      src={signatureData}
                      alt="Signature"
                      style={{ width: 200, height: 80, display: 'block', borderRadius: 8, border: '1px solid #ccc' }}
                    />
                  </span>
                  {/* Stamp image */}
                  <div className="flex-shrink-0">
                    <img
                      src="/חתימה מסמכים (5).png"
                      alt="Stamp"
                      style={{
                        width: 'auto',
                        height: 150,
                        maxWidth: 250,
                        display: 'block',
                        objectFit: 'contain'
                      }}
                    />
                  </div>
                </span>
              );
            } else {
              parts.push(
                <span
                  key={baseId}
                  className="inline-flex items-center gap-4 mx-2 align-middle relative"
                  style={{
                    minWidth: 220,
                    minHeight: 100
                  }}
                >
                  <div className="border-2 border-blue-300 rounded-lg bg-gray-50 p-3">
                    <SignaturePad
                      ref={ref => {
                        if (ref && signaturePads) signaturePads[baseId] = ref;
                        // Disable signature pad in edit mode or when read-only
                        if (ref && (isReadOnly || editing)) {
                          ref.getCanvas().style.pointerEvents = 'none';
                          ref.getCanvas().style.opacity = '0.6';
                        }
                      }}
                      penColor="#4c6fff"
                      backgroundColor="transparent"
                      canvasProps={{
                        width: 200,
                        height: 80,
                        style: {
                          display: 'block',
                          borderRadius: 8,
                          background: 'transparent',
                          // Inactive in edit mode or when read-only
                          pointerEvents: (isReadOnly || editing) ? 'none' : 'auto',
                          opacity: (isReadOnly || editing) ? 0.6 : 1,
                        },
                      }}
                      onEnd={() => {
                        // Only allow signing when not in edit mode and not read-only
                        if (!isReadOnly && !editing && signaturePads && signaturePads[baseId]) {
                          const dataUrl = signaturePads[baseId].getTrimmedCanvas().toDataURL('image/png');
                          setClientInputs(inputs => ({ ...inputs, [baseId]: dataUrl }));
                        }
                      }}
                    />
                    <div className="text-xs text-gray-500 text-center mt-2 font-medium">Sign here</div>
                  </div>
                  {/* Stamp image */}
                  <div className="flex-shrink-0">
                    <img
                      src="/חתימה מסמכים (5).png"
                      alt="Stamp"
                      style={{
                        width: 'auto',
                        height: 150,
                        maxWidth: 250,
                        display: 'block',
                        objectFit: 'contain'
                      }}
                    />
                  </div>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (editor) {
                          const content = editor.getJSON();
                          const removePlaceholder = (node: any): any => {
                            if (node.type === 'text' && node.text) {
                              const newText = node.text.replace(new RegExp(`\\{\\{signature:${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g'), '');
                              if (newText !== node.text) {
                                return newText ? { ...node, text: newText } : null;
                              }
                            }
                            if (node.content) {
                              const processedContent = Array.isArray(node.content)
                                ? node.content.map(removePlaceholder).filter(Boolean)
                                : removePlaceholder(node.content);
                              return { ...node, content: processedContent };
                            }
                            return node;
                          };
                          const newContent = removePlaceholder(content);
                          editor.commands.setContent(newContent);
                        }
                        setClientInputs(inputs => {
                          const newInputs = { ...inputs };
                          delete newInputs[baseId];
                          return newInputs;
                        });
                      }}
                      className="btn btn-circle btn-xs btn-error"
                      style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        width: '20px',
                        height: '20px',
                        minHeight: '20px',
                        padding: 0,
                        zIndex: 10
                      }}
                      title="Delete field"
                    >
                      <MinusIcon className="w-3 h-3" />
                    </button>
                  )}
                </span>
              );
            }
            lastIndex = match.index + match[1].length;
            continue;
          }

          // Handle newline
          if (placeholder === '\n') {
            parts.push(<br key={keyPrefix + '-br-' + match.index} />);
          }
          lastIndex = match.index + match[1].length;
        }

        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }

        // If we processed placeholders with IDs, return the parts
        // Otherwise, continue to process {{text}} and {{signature}} without IDs below
        if (parts.length > 0) {
          return parts;
        }
      }

      // Always render {{text}}, {{date}}, and {{signature}} as input fields and signature pads (placeholders without IDs)
      console.log('🎨 Checking for placeholders in text:', text);
      console.log('🎨 Has placeholders:', /\{\{(text|date|signature)\}\}/.test(text));
      if (text && /\{\{(text|date|signature)\}\}/.test(text)) {
        const parts = [];
        let lastIndex = 0;
        const regex = /({{text}}|{{date}}|{{signature}}|\n)/g;
        let match;
        let textCounter = 1;
        let dateCounter = 1;
        let signatureCounter = 1;

        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const placeholder = match[1];

          if (placeholder === '{{text}}') {
            const id = `text-${textCounter++}`;
            parts.push(
              <span
                key={id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  margin: '0 8px',
                  verticalAlign: 'middle',
                  position: 'relative',
                  gap: '4px'
                }}
              >
                <input
                  className="input input-bordered bg-white border-2 border-blue-300 focus:border-blue-500 rounded-lg"
                  placeholder="Enter text"
                  style={{
                    minWidth: 200,
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '16px',
                    lineHeight: '1.5',
                    margin: 0
                  }}
                  value={clientInputs[id] || ''}
                  onChange={e => setClientInputs(inputs => ({ ...inputs, [id]: e.target.value }))}
                  disabled={isReadOnly}
                />
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (editor) {
                        const content = editor.getJSON();
                        const removePlaceholder = (node: any): any => {
                          if (node.type === 'text' && node.text) {
                            const newText = node.text.replace(/\{\{text\}\}/, '');
                            if (newText !== node.text) {
                              return newText ? { ...node, text: newText } : null;
                            }
                          }
                          if (node.content) {
                            const processedContent = Array.isArray(node.content)
                              ? node.content.map(removePlaceholder).filter(Boolean)
                              : removePlaceholder(node.content);
                            return { ...node, content: processedContent };
                          }
                          return node;
                        };
                        const newContent = removePlaceholder(content);
                        editor.commands.setContent(newContent);
                      }
                      setClientInputs(inputs => {
                        const newInputs = { ...inputs };
                        delete newInputs[id];
                        return newInputs;
                      });
                    }}
                    className="btn btn-circle btn-xs btn-error"
                    style={{
                      width: '20px',
                      height: '20px',
                      minHeight: '20px',
                      padding: 0,
                      flexShrink: 0
                    }}
                    title="Delete field"
                  >
                    <MinusIcon className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
          } else if (placeholder === '{{date}}') {
            const id = `date-${dateCounter++}`;
            const dateValue = clientInputs[id] || '';
            parts.push(
              <span
                key={id}
                className="inline-flex items-center relative field-wrapper"
                style={{
                  verticalAlign: 'middle',
                  margin: '0 8px',
                  display: 'inline-flex',
                  gap: '4px'
                }}
                data-field-id={id}
                data-field-type="date"
              >
                <input
                  type="date"
                  className="input input-bordered bg-white border-2 border-blue-300 focus:border-blue-500 rounded-lg"
                  value={dateValue ? (() => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                      return dateValue;
                    }
                    try {
                      const date = new Date(dateValue);
                      if (!isNaN(date.getTime())) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        return `${year}-${month}-${day}`;
                      }
                    } catch (e) {
                    }
                    return '';
                  })() : ''}
                  onChange={e => {
                    const selectedDate = e.target.value;
                    setClientInputs(inputs => ({ ...inputs, [id]: selectedDate }));
                  }}
                  disabled={isReadOnly}
                  required
                  aria-label="Select date (required)"
                  placeholder=""
                  readOnly={false}
                  autoComplete="off"
                  data-input-type="date"
                  style={{
                    minWidth: 200,
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '16px',
                    lineHeight: '1.5',
                    margin: 0,
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    cursor: isReadOnly ? 'not-allowed' : 'pointer',
                    appearance: 'auto',
                    WebkitAppearance: 'menulist',
                    MozAppearance: 'menulist'
                  }}
                />
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (editor) {
                        const content = editor.getJSON();
                        const removePlaceholder = (node: any): any => {
                          if (node.type === 'text' && node.text) {
                            const newText = node.text.replace(/\{\{date\}\}/, '');
                            if (newText !== node.text) {
                              return newText ? { ...node, text: newText } : null;
                            }
                          }
                          if (node.content) {
                            const processedContent = Array.isArray(node.content)
                              ? node.content.map(removePlaceholder).filter(Boolean)
                              : removePlaceholder(node.content);
                            return { ...node, content: processedContent };
                          }
                          return node;
                        };
                        const newContent = removePlaceholder(content);
                        editor.commands.setContent(newContent);
                      }
                      setClientInputs(inputs => {
                        const newInputs = { ...inputs };
                        delete newInputs[id];
                        return newInputs;
                      });
                    }}
                    className="btn btn-circle btn-xs btn-error"
                    style={{
                      width: '20px',
                      height: '20px',
                      minHeight: '20px',
                      padding: 0,
                      flexShrink: 0
                    }}
                    title="Delete field"
                  >
                    <MinusIcon className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
          } else if (placeholder === '{{signature}}') {
            const id = `signature-${signatureCounter++}`;
            const signatureData = clientInputs[id];

            if (signatureData && signatureData.startsWith('data:image/')) {
              parts.push(
                <span key={id} className="inline-flex items-center gap-4 mx-2">
                  <span className="inline-block">
                    <img
                      src={signatureData}
                      alt="Signature"
                      style={{ width: 200, height: 80, display: 'block', borderRadius: 8, border: '1px solid #ccc' }}
                    />
                  </span>
                  {/* Stamp image */}
                  <div className="flex-shrink-0">
                    <img
                      src="/חתימה מסמכים (5).png"
                      alt="Stamp"
                      style={{
                        width: 'auto',
                        height: 150,
                        maxWidth: 250,
                        display: 'block',
                        objectFit: 'contain'
                      }}
                    />
                  </div>
                </span>
              );
            } else {
              parts.push(
                <span key={id} className="inline-flex items-center gap-4 mx-2 align-middle relative" style={{ minWidth: 220, minHeight: 100 }}>
                  <div className="border-2 border-blue-300 rounded-lg bg-gray-50 p-3">
                    <SignaturePad
                      ref={ref => {
                        if (ref && signaturePads) signaturePads[id] = ref;
                        if (ref && isReadOnly) {
                          // Disable the canvas when read-only
                          ref.getCanvas().style.pointerEvents = 'none';
                          ref.getCanvas().style.opacity = '0.6';
                        }
                      }}
                      penColor="#4c6fff"
                      backgroundColor="transparent"
                      canvasProps={{
                        width: 200,
                        height: 80,
                        style: {
                          display: 'block',
                          borderRadius: 8,
                          background: 'transparent',
                          pointerEvents: isReadOnly ? 'none' : 'auto',
                          opacity: isReadOnly ? 0.6 : 1,
                        },
                      }}
                      onEnd={() => {
                        if (!isReadOnly && signaturePads && signaturePads[id]) {
                          const dataUrl = signaturePads[id].getTrimmedCanvas().toDataURL('image/png');
                          setClientInputs(inputs => ({ ...inputs, [id]: dataUrl }));
                        }
                      }}
                    />
                    <div className="text-xs text-gray-500 text-center mt-2 font-medium">Sign here</div>
                  </div>
                  {/* Stamp image */}
                  <div className="flex-shrink-0">
                    <img
                      src="/חתימה מסמכים (5).png"
                      alt="Stamp"
                      style={{
                        width: 'auto',
                        height: 150,
                        maxWidth: 250,
                        display: 'block',
                        objectFit: 'contain'
                      }}
                    />
                  </div>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (editor) {
                          const content = editor.getJSON();
                          const removePlaceholder = (node: any): any => {
                            if (node.type === 'text' && node.text) {
                              const newText = node.text.replace(/\{\{signature\}\}/, '');
                              if (newText !== node.text) {
                                return newText ? { ...node, text: newText } : null;
                              }
                            }
                            if (node.content) {
                              const processedContent = Array.isArray(node.content)
                                ? node.content.map(removePlaceholder).filter(Boolean)
                                : removePlaceholder(node.content);
                              return { ...node, content: processedContent };
                            }
                            return node;
                          };
                          const newContent = removePlaceholder(content);
                          editor.commands.setContent(newContent);
                        }
                        setClientInputs(inputs => {
                          const newInputs = { ...inputs };
                          delete newInputs[id];
                          return newInputs;
                        });
                      }}
                      className="btn btn-circle btn-xs btn-error"
                      style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        width: '20px',
                        height: '20px',
                        minHeight: '20px',
                        padding: 0,
                        zIndex: 10
                      }}
                      title="Delete field"
                    >
                      <MinusIcon className="w-3 h-3" />
                    </button>
                  )}
                </span>
              );
            }
          } else if (placeholder === '\n') {
            parts.push(<br key={keyPrefix + '-br-' + match.index} />);
          }
          lastIndex = match.index + match[1].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts;

      }

      // Replace other placeholders (but preserve text/signature placeholders in client view)
      text = fillAllPlaceholders(text, customPricing, client, contract);

      // Robustly replace price_per_applicant for each tier row
      if (text && customPricing && customPricing.pricing_tiers && text.includes('{{price_per_applicant}}')) {
        const currency = customPricing.currency || 'USD';

        // Get all available tiers in order
        const tierOrder = ['1', '2', '3', '4-7', '8-9', '10-15', '16+'];
        const availableTiers = tierOrder.filter(key =>
          customPricing.pricing_tiers[key] !== undefined &&
          customPricing.pricing_tiers[key] !== null &&
          customPricing.pricing_tiers[key] !== 0
        );

        let currentTierIndex = 0;

        // Find each {{price_per_applicant}} placeholder and replace it based on context
        while (text.includes('{{price_per_applicant}}')) {
          const placeholderIndex = text.indexOf('{{price_per_applicant}}');
          const contextBefore = text.substring(Math.max(0, placeholderIndex - 200), placeholderIndex);

          let tierKey: string | null = null;

          // Check for tier patterns in order of specificity (most specific first)
          // Support both English and Hebrew patterns
          const recentContext = contextBefore.substring(Math.max(0, contextBefore.length - 80));

          // 16+ patterns (English and Hebrew)
          if (/16\s*\+\s*applicant|16\s+or\s+more\s+applicant|16\s+applicant.*or\s+more/i.test(recentContext) ||
            /16\+?\s*מבקש|מעל\s*16|מ-?16\s*ומעלה/i.test(recentContext)) {
            tierKey = '16+';
          }
          // 10-15 patterns
          else if (/10\s*[-–]\s*15\s+applicant/i.test(recentContext) ||
            /10\s*[-–]\s*15\s*מבקש/i.test(recentContext)) {
            tierKey = '10-15';
          }
          // 8-9 patterns
          else if (/8\s*[-–]\s*9\s+applicant/i.test(recentContext) ||
            /8\s*[-–]\s*9\s*מבקש/i.test(recentContext)) {
            tierKey = '8-9';
          }
          // 4-7 patterns
          else if (/4\s*[-–]\s*7\s+applicant/i.test(recentContext) ||
            /4\s*[-–]\s*7\s*מבקש/i.test(recentContext)) {
            tierKey = '4-7';
          }
          // 3 applicants
          else if (/\b3\s+applicant/i.test(recentContext) ||
            /\b3\s*מבקש/i.test(recentContext)) {
            tierKey = '3';
          }
          // 2 applicants
          else if (/\b2\s+applicant/i.test(recentContext) ||
            /\b2\s*מבקש|שני\s*מבקש/i.test(recentContext)) {
            tierKey = '2';
          }
          // 1 applicant - including "לכל מבקש" (for each applicant)
          else if (/\b1\s+applicant|one\s+applicant|For\s+one\s+applicant/i.test(recentContext) ||
            /\b1\s*מבקש|מבקש\s*אחד|לכל\s*מבקש/i.test(recentContext)) {
            tierKey = '1';
          }

          // If no specific tier matched, use sequential replacement from available tiers
          if (!tierKey && currentTierIndex < availableTiers.length) {
            tierKey = availableTiers[currentTierIndex];
            console.log(`📝 renderTiptapContent: Using sequential tier ${tierKey} (index ${currentTierIndex} of ${availableTiers.length})`);
            currentTierIndex++;
          }

          if (tierKey && customPricing.pricing_tiers[tierKey] !== undefined) {
            const price = (customPricing.pricing_tiers[tierKey] || 0).toLocaleString();
            text = text.replace('{{price_per_applicant}}', `${currency} ${price}`);
            console.log(`✅ renderTiptapContent: Replaced {{price_per_applicant}} for tier ${tierKey} with ${currency} ${price}`);
          } else {
            console.warn('⚠️ renderTiptapContent: Could not determine tier. Recent context:', recentContext);
            text = text.replace('{{price_per_applicant}}', `${currency} 0`);
          }
        }
      }

      // Payment plan row placeholders are now handled at the top (line 2090)
      // This duplicate handler is removed to avoid conflicts with early returns

      // Handle individual pricing tier placeholders
      if (text && customPricing && customPricing.pricing_tiers) {
        const currency = customPricing.currency || 'USD';

        // Replace specific tier placeholders
        text = text.replace(/For one applicant-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For one applicant- ${currency} ${(customPricing.pricing_tiers['1'] || 0).toLocaleString()}`);

        text = text.replace(/For 2 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 2 applicants- ${currency} ${(customPricing.pricing_tiers['2'] || 0).toLocaleString()}`);

        text = text.replace(/For 3 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 3 applicants- ${currency} ${(customPricing.pricing_tiers['3'] || 0).toLocaleString()}`);

        text = text.replace(/For 4-7 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 4-7 applicants- ${currency} ${(customPricing.pricing_tiers['4-7'] || 0).toLocaleString()}`);

        text = text.replace(/For 8-9 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 8-9 applicants- ${currency} ${(customPricing.pricing_tiers['8-9'] || 0).toLocaleString()}`);

        text = text.replace(/For 10-15 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 10-15 applicants- ${currency} ${(customPricing.pricing_tiers['10-15'] || 0).toLocaleString()}`);

        text = text.replace(/For 16 applicants or more-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 16 applicants or more- ${currency} ${(customPricing.pricing_tiers['16+'] || 0).toLocaleString()}`);
      }

      // Handle payment plan placeholders
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
        const rowIndex = paymentPlanIndex.current;
        const row = customPricing.payment_plan[rowIndex];
        paymentPlanIndex.current++;

        if (row) {
          if (asClient) {
            // In client view, show the payment plan data as text
            return (
              <span className="inline-block text-black font-medium border-b-2 border-black">
                {row.percent}% {row.due} = {customPricing.currency} {row.amount?.toLocaleString()}
              </span>
            );
          } else {
            // In admin view, show editable fields
            return (
              <span className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2 my-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input input-bordered input-sm w-16 text-center bg-white"
                  value={row.percent}
                  onChange={e => handlePaymentPlanChange(rowIndex, 'percent', Number(e.target.value))}
                  placeholder="%"
                />
                <span className="text-sm font-medium">%</span>
                <input
                  type="text"
                  className="input input-bordered input-sm w-32 text-center bg-white"
                  value={row.due_date}
                  onChange={e => handlePaymentPlanChange(rowIndex, 'due_date', e.target.value)}
                  placeholder="When due"
                />
                <span className="text-sm font-medium">=</span>
                <input
                  type="number"
                  min={0}
                  className="input input-bordered input-sm w-24 text-center bg-white"
                  value={row.value}
                  onChange={e => handlePaymentPlanChange(rowIndex, 'value', Number(e.target.value))}
                  placeholder="Amount"
                />
                <span className="text-sm font-medium">{customPricing.currency}</span>
              </span>
            );
          }
        }
      }

      // Default placeholder replacement
      if (text && customPricing) {
        text = text.replace(/{{applicant_count}}/g, customPricing.applicant_count?.toString() || '');
        text = text.replace(/{{total_amount}}/g, customPricing.total_amount?.toLocaleString() || '');
        text = text.replace(/{{final_amount}}/g, customPricing.final_amount?.toLocaleString() || '');
        text = text.replace(/{{discount_percentage}}/g, customPricing.discount_percentage?.toString() || '');
        text = text.replace(/{{discount_amount}}/g, customPricing.discount_amount?.toLocaleString() || '');
        text = text.replace(/{{currency}}/g, customPricing.currency || '');
        text = text.replace(/{{client_name}}/g, client?.name || '');
        text = text.replace(/{{client_phone}}/g, client?.phone || client?.mobile || '');
        text = text.replace(/{{client_email}}/g, client?.email || '');
        // Don't replace {{date}} - it should be handled as a placeholder or date picker
        // Only replace generic {{date}} if we're sure it's not meant to be a date picker
        // text = text.replace(/{{date}}/g, new Date().toLocaleDateString());
      }

      // Apply text formatting
      if (content.marks && content.marks.length > 0) {
        const formattedText = content.marks.reduce((acc: any, mark: any) => {
          if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
          if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
          if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
          if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
          return acc;
        }, text);

        // Handle line breaks after formatting
        if (typeof formattedText === 'string' && formattedText.includes('\n')) {
          const lines = formattedText.split('\n');
          return lines.map((line: string, index: number) => (
            <React.Fragment key={keyPrefix + '-line-' + index}>
              {index > 0 && <br />}
              {line}
            </React.Fragment>
          ));
        }
        return formattedText;
      }

      // Handle line breaks in plain text
      if (text && text.includes('\n')) {
        const lines = text.split('\n');
        return lines.map((line: string, index: number) => (
          <React.Fragment key={keyPrefix + '-line-' + index}>
            {index > 0 && <br />}
            {line}
          </React.Fragment>
        ));
      }
      return text;
    }

    switch (content.type) {
      case 'paragraph':
        const paragraphContent = renderTiptapContent(content.content, keyPrefix + '-p', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex);
        // Always render paragraphs - even empty ones represent line breaks
        // Check if there's a saved text alignment from the admin
        const savedTextAlign = content.attrs?.textAlign;
        const hasContent = paragraphContent && (typeof paragraphContent === 'string' ? paragraphContent.trim().length > 0 : true);

        if (savedTextAlign) {
          // Use the saved alignment from admin
          return (
            <p
              key={keyPrefix}
              className="mb-3"
              style={{ textAlign: savedTextAlign }}
            >
              {hasContent ? paragraphContent : <br />}
            </p>
          );
        } else {
          // No saved alignment - auto-detect RTL
          const paragraphText = content.content?.map((n: any) => n.text || '').join('') || '';
          const isRTLParagraph = isRTL(paragraphText);
          return (
            <p
              key={keyPrefix}
              className="mb-3"
              dir={isRTLParagraph ? 'rtl' : 'ltr'}
              style={{
                textAlign: isRTLParagraph ? 'right' : 'left',
                direction: isRTLParagraph ? 'rtl' : 'ltr'
              }}
            >
              {hasContent ? paragraphContent : <br />}
            </p>
          );
        }
      case 'heading':
        const level = content.attrs?.level || 1;
        const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        const HeadingTag = headingTags[Math.max(0, Math.min(5, level - 1))] || 'h1';

        // Check if there's a saved text alignment from the admin
        const savedHeadingAlign = content.attrs?.textAlign;

        if (savedHeadingAlign) {
          // Use the saved alignment from admin
          return React.createElement(
            HeadingTag,
            {
              key: keyPrefix,
              style: { textAlign: savedHeadingAlign }
            },
            renderTiptapContent(content.content, keyPrefix + '-h', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)
          );
        } else {
          // No saved alignment - auto-detect RTL
          const headingText = content.content?.map((n: any) => n.text || '').join('') || '';
          const isRTLHeading = isRTL(headingText);
          return React.createElement(
            HeadingTag,
            {
              key: keyPrefix,
              dir: isRTLHeading ? 'rtl' : 'ltr',
              style: {
                textAlign: isRTLHeading ? 'right' : 'left',
                direction: isRTLHeading ? 'rtl' : 'ltr'
              }
            },
            renderTiptapContent(content.content, keyPrefix + '-h', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)
          );
        }
      case 'bulletList':
        const bulletListText = JSON.stringify(content.content);
        const isRTLBulletList = isRTL(bulletListText);
        return (
          <ul
            key={keyPrefix}
            dir={isRTLBulletList ? 'rtl' : 'ltr'}
            style={{ textAlign: isRTLBulletList ? 'right' : 'left' }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-ul', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}
          </ul>
        );
      case 'orderedList':
        const orderedListText = JSON.stringify(content.content);
        const isRTLOrderedList = isRTL(orderedListText);
        return (
          <ol
            key={keyPrefix}
            dir={isRTLOrderedList ? 'rtl' : 'ltr'}
            style={{ textAlign: isRTLOrderedList ? 'right' : 'left' }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-ol', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}
          </ol>
        );
      case 'listItem':
        const listItemText = content.content?.map((n: any) => {
          if (n.type === 'paragraph' && n.content) {
            return n.content.map((c: any) => c.text || '').join('');
          }
          return '';
        }).join('') || '';
        const isRTLListItem = isRTL(listItemText);
        return (
          <li
            key={keyPrefix}
            dir={isRTLListItem ? 'rtl' : 'ltr'}
            style={{ textAlign: isRTLListItem ? 'right' : 'left' }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-li', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}
          </li>
        );
      case 'blockquote':
        const blockquoteText = JSON.stringify(content.content);
        const isRTLBlockquote = isRTL(blockquoteText);
        return (
          <blockquote
            key={keyPrefix}
            dir={isRTLBlockquote ? 'rtl' : 'ltr'}
            style={{ textAlign: isRTLBlockquote ? 'right' : 'left' }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-bq', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}
          </blockquote>
        );
      case 'horizontalRule':
        return <hr key={keyPrefix} />;
      case 'hardBreak':
        return <br key={keyPrefix} />;
      default:
        return renderTiptapContent(content.content, keyPrefix + '-d', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex);
    }
  };

  // Add a helper to fill TipTap JSON with clientInputs
  function fillTiptapJsonWithInputs(content: any, clientInputs: { [key: string]: string }, keyPrefix = '', placeholderIndex?: { text: number; signature: number }): any {
    if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0 };
    if (!content) return content;
    if (Array.isArray(content)) {
      // In fillTiptapJsonWithInputs, when recursing into an array, pass the SAME placeholderIndex object to all children (do NOT clone)
      return content.map((n, i) =>
        fillTiptapJsonWithInputs(
          n,
          clientInputs,
          keyPrefix + '-' + i,
          placeholderIndex // DO NOT CLONE
        )
      );
    }
    if (content.type === 'text' && content.text) {
      let newText = content.text;

      // Replace {{text:ID}} fields with actual client input values
      newText = newText.replace(/\{\{text:([^}]+)\}\}/g, (_m: string, id: string) => clientInputs[id] || '');

      // Replace {{signature:ID}} fields with signature data
      newText = newText.replace(/\{\{signature:([^}]+)\}\}/g, (_m: string, id: string) => clientInputs[id] || '[Signed]');

      // Replace {{date:ID}} fields with formatted date values
      newText = newText.replace(/\{\{date:([^}]+)\}\}/g, (_m: string, id: string) => {
        const dateValue = clientInputs[id] || '';
        if (!dateValue) return '';

        // Format date for display
        try {
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
            const date = new Date(dateValue + 'T00:00:00');
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
            }
          } else {
            const date = new Date(dateValue);
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
            }
          }
        } catch (e) {
          // If formatting fails, return the raw value
        }
        return dateValue;
      });

      return { ...content, text: newText };
    }
    if (content.content) {
      return { ...content, content: fillTiptapJsonWithInputs(content.content, clientInputs, keyPrefix, placeholderIndex) };
    }
    return content;
  }

  const handleShareContractLink = async () => {
    if (!contract) return;
    let publicToken = contract.public_token;
    if (!publicToken) {
      publicToken = uuidv4();
      await supabase.from('contracts').update({ public_token: publicToken }).eq('id', contract.id);
      setContract((prev: any) => ({ ...prev, public_token: publicToken }));
    }
    // Always use production domain for public contract links
    const publicUrl = `${getFrontendBaseUrl()}/public-contract/${contract.id}/${publicToken}`;
    await navigator.clipboard.writeText(publicUrl);
    alert('Link copied!');
  };

  const handleMobileShare = async () => {
    if (!contract) return;

    // Check if Web Share API is available
    if (navigator.share) {
      let publicToken = contract.public_token;
      if (!publicToken) {
        publicToken = uuidv4();
        await supabase.from('contracts').update({ public_token: publicToken }).eq('id', contract.id);
        setContract((prev: any) => ({ ...prev, public_token: publicToken }));
      }
      const publicUrl = `${getFrontendBaseUrl()}/public-contract/${contract.id}/${publicToken}`;

      try {
        await navigator.share({
          title: 'Contract Link',
          text: 'Check out this contract',
          url: publicUrl,
        });
      } catch (err: any) {
        // User cancelled or error occurred, fallback to clipboard
        if (err.name !== 'AbortError') {
          await navigator.clipboard.writeText(publicUrl);
          alert('Link copied!');
        }
      }
    } else {
      // Fallback to regular share function if Web Share API not available
      handleShareContractLink();
    }
  };

  // Add save state
  const [isSaving, setIsSaving] = useState(false);

  // Save customPricing to DB and refresh contract content
  const handleSaveCustomPricing = async () => {
    if (!contract || !customPricing) return;
    setIsSaving(true);
    try {
      await supabase.from('contracts').update({
        custom_pricing: customPricing,
        total_amount: customPricing.total_amount,
        applicant_count: customPricing.applicant_count,
      }).eq('id', contract.id);

      // Update local contract state
      setContract((prev: any) => ({ ...prev, custom_pricing: customPricing }));

      // Force refresh of contract content to reflect changes
      setRenderKey(prev => prev + 1);

      // Reset content hash to force useEffect to refresh content
      lastContentHashRef.current = '';

      // Refresh editor content immediately (works for both edit and readonly modes)
      if (editor && template) {
        const content = contract.custom_content || template.content;
        if (content) {
          try {
            let processedContent = normalizeTiptapContent(content);
            processedContent = JSON.parse(JSON.stringify(processedContent)); // Deep clone

            if (customPricing && client) {
              // Replace pricing and other placeholders but keep {{text}} and {{signature}} for the custom renderer
              processedContent = fillPlaceholdersInTiptapContent(processedContent, customPricing, client, contract, editing, { current: 0 });
            }

            // Clean up any empty nodes
            processedContent = cleanTiptapContent(processedContent);

            // Final validation before setting content
            if (!processedContent || processedContent.type !== 'doc') {
              processedContent = { type: 'doc', content: [] };
            }

            // Update editor content - this will refresh both edit and readonly views
            editor.commands.setContent(processedContent);
          } catch (error) {
            console.error('❌ Error refreshing editor content after save:', error);
          }
        }
      }

      alert('Pricing and payment plan saved! Contract content has been updated.');
    } catch (err) {
      alert('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete contract handler
  const handleDeleteContract = async () => {
    if (!contract) return;
    if (!window.confirm('Are you sure you want to delete this contract? This action cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('contracts')
        .delete()
        .eq('id', contract.id);

      if (error) {
        console.error('Error deleting contract:', error);
        alert(`Failed to delete contract: ${error.message}`);
        return;
      }

      alert('Contract deleted successfully.');

      // Navigate back to client page
      if (leadNumber) {
        navigate(`/clients/${leadNumber}`);
      } else if (client?.id) {
        const clientLeadNumber = client.lead_number || client.id.toString().replace('legacy_', '');
        navigate(`/clients/${clientLeadNumber}`);
      } else {
        navigate('/clients');
      }
    } catch (err: any) {
      console.error('Exception deleting contract:', err);
      alert(`Failed to delete contract: ${err.message || 'Unknown error'}`);
    }
  };

  // Render signed contract content (already filled-in by client)
  const renderSignedContractContent = (content: any, keyPrefix = ''): React.ReactNode => {
    if (!content) return null;
    if (Array.isArray(content)) {
      return content.map((n, i) => renderSignedContractContent(n, keyPrefix + '-' + i));
    }
    if (content.type === 'text') {
      let text = content.text;
      text = fillAllPlaceholders(text, customPricing, client, contract);

      // Handle both {{text}}, {{date}}, and {{signature}} placeholders that might still be in signed contracts
      if (text && /\{\{(text|date|signature)(:[^}]+)?\}\}/.test(text)) {
        const parts = [];
        let lastIndex = 0;
        // Match date FIRST, then signature, then text to prevent confusion
        const regex = /({{date(:[^}]+)?}}|{{signature(:[^}]+)?}}|{{text(:[^}]+)?}}|\n)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const placeholder = match[1];
          const dateMatch = placeholder.match(/^{{date(:[^}]+)?}}$/);
          const textMatch = placeholder.match(/^{{text(:[^}]+)?}}$/);
          const sigMatch = placeholder.match(/^{{signature(:[^}]+)?}}$/);

          // Handle date fields first
          if (dateMatch) {
            const id = dateMatch[1] ? dateMatch[1].substring(1) : null;

            // Try to find the date value in clientInputs
            // The ID from placeholder might be like "date-1" or just a number
            let dateValue = '';

            if (id) {
              // Try exact match first
              dateValue = clientInputs[id] || '';

              // If no exact match, try variations
              if (!dateValue) {
                // Try with different ID formats
                const variations = [
                  `date-${id}`,
                  id.replace(/^date-/, ''),
                  id,
                  ...Object.keys(clientInputs).filter(key =>
                    key.includes(id) || id.includes(key)
                  )
                ];

                for (const variant of variations) {
                  if (clientInputs[variant]) {
                    dateValue = clientInputs[variant];
                    break;
                  }
                }
              }
            }

            // If still no value, try to find any date field
            if (!dateValue) {
              const dateKeys = Object.keys(clientInputs).filter(key =>
                key.toLowerCase().includes('date')
              );

              if (dateKeys.length === 1) {
                // Only one date field, use it
                dateValue = clientInputs[dateKeys[0]];
              } else if (dateKeys.length > 0) {
                // Multiple date fields - try to match by numeric part if ID has numbers
                if (id) {
                  const numericMatch = id.match(/\d+/);
                  if (numericMatch) {
                    const numId = numericMatch[0];
                    const matchingKey = dateKeys.find(key => key.includes(numId));
                    if (matchingKey) {
                      dateValue = clientInputs[matchingKey];
                    }
                  }
                }

                // If still no match and only one date key, use it
                if (!dateValue && dateKeys.length === 1) {
                  dateValue = clientInputs[dateKeys[0]];
                }
              }
            }

            let displayDate = '';

            // Format date for display
            if (dateValue) {
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                // Already in YYYY-MM-DD format, convert to readable format
                try {
                  const date = new Date(dateValue + 'T00:00:00'); // Add time to avoid timezone issues
                  if (!isNaN(date.getTime())) {
                    displayDate = date.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    });
                  }
                } catch (e) {
                  displayDate = dateValue;
                }
              } else {
                try {
                  const date = new Date(dateValue);
                  if (!isNaN(date.getTime())) {
                    displayDate = date.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    });
                  }
                } catch (e) {
                  displayDate = dateValue;
                }
              }
            }

            // For signed contracts, show the formatted date
            parts.push(
              <span
                key={id || 'date-field'}
                className="inline-block bg-green-50 border-2 border-green-300 rounded-lg px-3 py-2 mx-1 text-sm font-medium text-green-800 min-w-[150px]"
              >
                {displayDate || dateValue || '[No date provided]'}
              </span>
            );
          } else if (textMatch) {
            const id = textMatch[1] ? textMatch[1].substring(1) : 'text-input';
            const clientValue = clientInputs[id] || '[No input provided]';
            // For signed contracts, show the actual client input value
            parts.push(
              <span key={id} className="inline-block bg-green-50 border-2 border-green-300 rounded-lg px-3 py-2 mx-1 text-sm font-medium text-green-800 min-w-[150px]">
                {clientValue}
              </span>
            );
          } else if (sigMatch) {
            const id = sigMatch[1] ? sigMatch[1].substring(1) : 'signature';
            // Try to find signature data by ID
            let signatureData = clientInputs[id];

            // If not found by exact ID, try variations (e.g., signature-1, signature-0)
            if (!signatureData) {
              // Try to find any signature field in clientInputs
              const signatureKeys = Object.keys(clientInputs).filter(key =>
                key.toLowerCase().includes('signature') && clientInputs[key] && clientInputs[key].startsWith('data:image/')
              );

              // If there's only one signature, use it
              if (signatureKeys.length === 1) {
                signatureData = clientInputs[signatureKeys[0]];
              } else if (signatureKeys.length > 0) {
                // Multiple signatures - try to match by numeric part of ID
                const numericMatch = id.match(/\d+/);
                if (numericMatch) {
                  const numId = numericMatch[0];
                  const matchingKey = signatureKeys.find(key => key.includes(numId));
                  if (matchingKey) {
                    signatureData = clientInputs[matchingKey];
                  } else {
                    // Use the first signature if no numeric match
                    signatureData = clientInputs[signatureKeys[0]];
                  }
                } else {
                  // Use the first signature if no numeric ID
                  signatureData = clientInputs[signatureKeys[0]];
                }
              }
            }

            // For signed contracts, show the actual signature if available
            if (signatureData && signatureData.startsWith('data:image/')) {
              parts.push(
                <span key={id} className="inline-flex items-center gap-4 mx-1">
                  <span className="inline-block">
                    <img
                      src={signatureData}
                      alt="Client Signature"
                      style={{ width: 150, height: 60, display: 'block', borderRadius: 4, border: '1px solid #ccc' }}
                    />
                  </span>
                  {/* Stamp image */}
                  <div className="flex-shrink-0">
                    <img
                      src="/חתימה מסמכים (5).png"
                      alt="Stamp"
                      style={{
                        width: 'auto',
                        height: 150,
                        maxWidth: 250,
                        display: 'block',
                        objectFit: 'contain'
                      }}
                    />
                  </div>
                </span>
              );
            } else {
              parts.push(
                <span key={id} className="inline-flex items-center gap-4 mx-1">
                  <span className="inline-block bg-blue-50 border-2 border-blue-300 rounded-lg px-3 py-2 text-sm font-medium text-blue-800">
                    ✓ [Client Signature]
                  </span>
                  {/* Stamp image */}
                  <div className="flex-shrink-0">
                    <img
                      src="/חתימה מסמכים (5).png"
                      alt="Stamp"
                      style={{
                        width: 'auto',
                        height: 150,
                        maxWidth: 250,
                        display: 'block',
                        objectFit: 'contain'
                      }}
                    />
                  </div>
                </span>
              );
            }
          } else if (placeholder === '\n') {
            parts.push(<br key={keyPrefix + '-br-' + match.index} />);
          }
          lastIndex = match.index + match[1].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts;
      }

      // Handle base64 image data that might be directly in the text (for signatures)
      if (text && text.includes('data:image/png;base64,')) {
        const parts = [];
        let lastIndex = 0;
        const regex = /(data:image\/png;base64,[A-Za-z0-9+/=]+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const imageData = match[1];
          parts.push(
            <span key={keyPrefix + '-img-' + match.index} className="inline-flex items-center gap-4 mx-1">
              <span className="inline-block">
                <img
                  src={imageData}
                  alt="Signature"
                  style={{ width: 150, height: 60, display: 'block', borderRadius: 4, border: '1px solid #ccc' }}
                />
              </span>
              {/* Stamp image */}
              <div className="flex-shrink-0">
                <img
                  src="/חתימה מסמכים (5).png"
                  alt="Stamp"
                  style={{
                    width: 'auto',
                    height: 150,
                    maxWidth: 250,
                    display: 'block',
                    objectFit: 'contain'
                  }}
                />
              </div>
            </span>
          );
          lastIndex = match.index + match[1].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts.length > 0 ? parts : text;
      }

      // Handle payment plan placeholders
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        const parts = [];
        let lastIndex = 0;
        const regex = /\{\{payment_plan_row\}\}/g;
        let match;
        let rowIndex = 0;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
          }
          const row = customPricing.payment_plan[rowIndex];
          if (row) {
            // Handle the new value format "value + VAT" or just "value"
            let displayValue = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Parse "value + VAT" format
                const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
                const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
                displayValue = totalValue.toLocaleString();
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValue = numValue.toLocaleString();
              }
            }

            parts.push(
              <span key={keyPrefix + '-pprow-' + rowIndex} className="inline-block text-black font-medium border-b-2 border-black">
                {row.percent}% {rowIndex === 0 && row.due_date ? `(${row.due_date}) ` : ''}= {customPricing.currency} {displayValue}
              </span>
            );
          }
          rowIndex++;
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts.length > 0 ? parts : text;
      }

      // Replace pricing placeholders with actual values
      if (text && customPricing && customPricing.pricing_tiers) {
        const currency = customPricing.currency || 'USD';
        const tierStructure = [
          { key: '1', label: 'For one applicant' },
          { key: '2', label: 'For 2 applicants' },
          { key: '3', label: 'For 3 applicants' },
          { key: '4-7', label: 'For 4-7 applicants' },
          { key: '8-9', label: 'For 8-9 applicants' },
          { key: '10-15', label: 'For 10-15 applicants' },
          { key: '16+', label: 'For 16 applicants or more' }
        ];

        tierStructure.forEach(tier => {
          const lineRegex = new RegExp(`(${tier.label}[^\\n]*?):?\\s*\\{\\{price_per_applicant\\}\\}`, 'g');
          text = text.replace(lineRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
        });
      }

      // Replace other placeholders
      text = fillAllPlaceholders(text, customPricing, client, contract);

      // Apply text formatting
      if (content.marks && content.marks.length > 0) {
        const formattedText = content.marks.reduce((acc: any, mark: any) => {
          if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
          if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
          if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
          if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
          return acc;
        }, text);

        // Handle line breaks after formatting
        if (typeof formattedText === 'string' && formattedText.includes('\n')) {
          const lines = formattedText.split('\n');
          return lines.map((line: string, index: number) => (
            <React.Fragment key={keyPrefix + '-line-' + index}>
              {index > 0 && <br />}
              {line}
            </React.Fragment>
          ));
        }
        return formattedText;
      }

      // Handle line breaks in plain text
      if (text && text.includes('\n')) {
        const lines = text.split('\n');
        return lines.map((line: string, index: number) => (
          <React.Fragment key={keyPrefix + '-line-' + index}>
            {index > 0 && <br />}
            {line}
          </React.Fragment>
        ));
      }
      return text;
    }

    switch (content.type) {
      case 'paragraph':
        const paragraphContent = renderSignedContractContent(content.content, keyPrefix + '-p');
        if (paragraphContent && (typeof paragraphContent === 'string' ? paragraphContent.trim() : true)) {
          // Check if paragraph contains input fields (React elements)
          const hasInputFields = React.isValidElement(paragraphContent) ||
            (Array.isArray(paragraphContent) && paragraphContent.some(item => React.isValidElement(item)));

          // Check if there's a saved text alignment from the admin
          const savedSignedAlign = content.attrs?.textAlign;

          let styleProps;
          if (savedSignedAlign) {
            // Use the saved alignment from admin
            styleProps = { style: { textAlign: savedSignedAlign } };
          } else {
            // No saved alignment - auto-detect RTL
            const signedParagraphText = content.content?.map((n: any) => n.text || '').join('') || '';
            const isRTLSignedParagraph = isRTL(signedParagraphText);
            styleProps = {
              dir: isRTLSignedParagraph ? 'rtl' as const : 'ltr' as const,
              style: {
                textAlign: isRTLSignedParagraph ? 'right' as const : 'left' as const,
                direction: isRTLSignedParagraph ? 'rtl' as const : 'ltr' as const
              }
            };
          }

          if (hasInputFields) {
            // Use div instead of p to avoid DOM nesting issues with input fields
            return <div key={keyPrefix} className="mb-3" {...styleProps}>{paragraphContent}</div>;
          } else {
            return <p key={keyPrefix} className="mb-3" {...styleProps}>{paragraphContent}</p>;
          }
        }
        return null;
      case 'heading':
        const level = content.attrs?.level || 1;
        const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        const HeadingTag = headingTags[Math.max(0, Math.min(5, level - 1))] || 'h1';

        // Check if there's a saved text alignment from the admin
        const savedSignedHeadingAlign = content.attrs?.textAlign;

        if (savedSignedHeadingAlign) {
          // Use the saved alignment from admin
          return React.createElement(
            HeadingTag,
            {
              key: keyPrefix,
              style: { textAlign: savedSignedHeadingAlign }
            },
            renderSignedContractContent(content.content, keyPrefix + '-h')
          );
        } else {
          // No saved alignment - auto-detect RTL
          const signedHeadingText = content.content?.map((n: any) => n.text || '').join('') || '';
          const isRTLSignedHeading = isRTL(signedHeadingText);
          return React.createElement(
            HeadingTag,
            {
              key: keyPrefix,
              dir: isRTLSignedHeading ? 'rtl' : 'ltr',
              style: {
                textAlign: isRTLSignedHeading ? 'right' : 'left',
                direction: isRTLSignedHeading ? 'rtl' : 'ltr'
              }
            },
            renderSignedContractContent(content.content, keyPrefix + '-h')
          );
        }
      case 'bulletList':
        const signedBulletListText = JSON.stringify(content.content);
        const isRTLSignedBulletList = isRTL(signedBulletListText);
        return (
          <ul
            key={keyPrefix}
            dir={isRTLSignedBulletList ? 'rtl' : 'ltr'}
            style={{ textAlign: isRTLSignedBulletList ? 'right' : 'left' }}
          >
            {renderSignedContractContent(content.content, keyPrefix + '-ul')}
          </ul>
        );
      case 'orderedList':
        const signedOrderedListText = JSON.stringify(content.content);
        const isRTLSignedOrderedList = isRTL(signedOrderedListText);
        return (
          <ol
            key={keyPrefix}
            dir={isRTLSignedOrderedList ? 'rtl' : 'ltr'}
            style={{ textAlign: isRTLSignedOrderedList ? 'right' : 'left' }}
          >
            {renderSignedContractContent(content.content, keyPrefix + '-ol')}
          </ol>
        );
      case 'listItem':
        const signedListItemText = content.content?.map((n: any) => {
          if (n.type === 'paragraph' && n.content) {
            return n.content.map((c: any) => c.text || '').join('');
          }
          return '';
        }).join('') || '';
        const isRTLSignedListItem = isRTL(signedListItemText);
        return (
          <li
            key={keyPrefix}
            dir={isRTLSignedListItem ? 'rtl' : 'ltr'}
            style={{ textAlign: isRTLSignedListItem ? 'right' : 'left' }}
          >
            {renderSignedContractContent(content.content, keyPrefix + '-li')}
          </li>
        );
      case 'blockquote':
        return <blockquote key={keyPrefix}>{renderSignedContractContent(content.content, keyPrefix + '-bq')}</blockquote>;
      case 'horizontalRule':
        return <hr key={keyPrefix} />;
      case 'hardBreak':
        return <br key={keyPrefix} />;
      default:
        return renderSignedContractContent(content.content, keyPrefix + '-d');
    }
  };

  // Refresh contract data to get the latest signed contract content
  const handleRefreshContract = async () => {
    if (!contract) return;
    setLoading(true);
    try {
      const { data: refreshedContract, error } = await supabase
        .from('contracts')
        .select(`
          *,
          contract_templates (
            id,
            name,
            content
          )
        `)
        .eq('id', contract.id)
        .single();

      if (error) throw error;

      setContract(refreshedContract);
      setTemplate(refreshedContract.contract_templates);

      // Load client inputs if available
      if (refreshedContract.client_inputs) {
        console.log('ContractPage: Refreshing client inputs:', refreshedContract.client_inputs);
        setClientInputs(refreshedContract.client_inputs);
      }

      setRenderKey(prev => prev + 1); // Force re-render

      if (refreshedContract.status === 'signed') {

      }
    } catch (error) {
      console.error('Error refreshing contract:', error);
    } finally {
      setLoading(false);
    }
  };

  // Print contract handler
  const handlePrint = () => {
    window.print();
  };

  // Download PDF handler
  const handleDownloadPDF = async () => {
    if (!contractContentRef.current) return;
    setPdfLoading(true);
    const clientName = (contract && contract.contact_name) ? contract.contact_name : (client?.name || 'Client');
    const filename = `contract-${clientName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${contract.id}.pdf`;

    try {
      // Clone and pre-process the element to convert all colors to RGB
      const elementToPrint = contractContentRef.current.cloneNode(true) as HTMLElement;
      elementToPrint.id = 'contract-print-area-pdf';

      // Add to DOM temporarily for processing
      elementToPrint.style.position = 'absolute';
      elementToPrint.style.left = '-9999px';
      elementToPrint.style.top = '0';
      elementToPrint.style.visibility = 'hidden';
      document.body.appendChild(elementToPrint);

      // Convert all computed styles to inline RGB styles
      const convertColorsToRGB = (el: HTMLElement) => {
        try {
          const computed = window.getComputedStyle(el);

          // Convert background colors
          const bgColor = computed.backgroundColor;
          if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            el.style.setProperty('background-color', bgColor, 'important');
          }

          // Remove gradient backgrounds
          if (computed.backgroundImage && computed.backgroundImage !== 'none') {
            el.style.setProperty('background-image', 'none', 'important');
            if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
              el.style.setProperty('background-color', '#ffffff', 'important');
            }
          }

          // Convert text colors
          const textColor = computed.color;
          if (textColor) {
            el.style.setProperty('color', textColor, 'important');
          }

          // Process children
          Array.from(el.children).forEach(child => {
            convertColorsToRGB(child as HTMLElement);
          });
        } catch (e) {
          // Ignore errors for individual elements
        }
      };

      // Wait for clone to be in DOM, then process
      setTimeout(() => {
        convertColorsToRGB(elementToPrint);

        // Add CSS to override any remaining problematic styles
        const styleOverride = document.createElement('style');
        styleOverride.id = 'pdf-style-override';
        styleOverride.textContent = `
          #contract-print-area-pdf * {
            background-image: none !important;
          }
          #contract-print-area-pdf [class*="gradient"] {
            background: #ffffff !important;
            background-color: #ffffff !important;
            background-image: none !important;
          }
        `;
        document.head.appendChild(styleOverride);

        // Wait a bit more for styles to apply
        setTimeout(() => {
          html2pdf(elementToPrint, {
            margin: [10, 10, 10, 10],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
              scale: 2,
              useCORS: true,
              logging: false
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
          }).then(() => {
            cleanup();
            setPdfLoading(false);
          }).catch((error: any) => {
            cleanup();
            throw error;
          });
        }, 200);
      }, 100);

      const cleanup = () => {
        if (elementToPrint.parentNode) {
          document.body.removeChild(elementToPrint);
        }
        const styleEl = document.getElementById('pdf-style-override');
        if (styleEl) {
          document.head.removeChild(styleEl);
        }
      };

    } catch (error: any) {
      console.error('Error generating PDF:', error);
      setPdfLoading(false);

      // Suggest using print instead
      if (confirm('PDF generation failed due to unsupported color formats. Would you like to use the Print dialog instead? (You can save as PDF from there)')) {
        handlePrint();
      } else {
        alert('Failed to generate PDF. Please try using the Print button and save as PDF from the print dialog.');
      }
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="loading loading-spinner loading-lg text-primary"></div>
        <p className="mt-4 text-gray-600">Loading contract...</p>
      </div>
    </div>
  );

  if (!contract) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">No Contract Found</h2>
          <p className="text-gray-600 mb-6">
            No contract has been created for client <strong>{client.name}</strong> yet.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(`/clients/${leadNumber}`)}
              className="btn btn-outline"
            >
              Back to Client
            </button>
            <button
              onClick={() => navigate(`/clients/${leadNumber}?tab=contact`)}
              className="btn btn-primary"
            >
              Create Contract
            </button>
          </div>
        </div>
      </div>
    </div>
  );


  const status = contract ? (contractStatuses[contract.id]?.status || contract.status) : 'draft';

  // Before the return statement in ContractPage, define VAT logic
  const archivalFee = customPricing?.archival_research_fee || 0;
  const baseTotal = (customPricing?.total_amount || 0) + archivalFee;
  const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';
  const vatAmount = isIsraeli ? Math.round(baseTotal * 0.18 * 100) / 100 : 0;
  const discountAmount = customPricing?.discount_amount || 0;
  const finalAmountWithVat = baseTotal + vatAmount - discountAmount;

  // In the side panel and contract, show total as final_amount + archival_research_fee
  const totalWithArchival = (customPricing?.final_amount || 0) + (customPricing?.archival_research_fee || 0);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div
        ref={headerRef}
        className="print-hide px-4 sm:px-6 pt-4 pb-2"
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-1 sm:space-x-4 flex-1 min-w-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                {status === 'signed' && (
                  <span className="badge badge-success badge-sm sm:badge-md">Signed</span>
                )}
                {status === 'draft' && (
                  <>
                    <button
                      onClick={() => {
                        let targetUrl = '/clients';
                        if (leadNumber) {
                          targetUrl = `/clients/${leadNumber}`;
                        } else if (client?.id) {
                          const clientLeadNumber = client.lead_number || client.id.toString().replace('legacy_', '');
                          targetUrl = `/clients/${clientLeadNumber}`;
                        }
                        // Use window.location.href to force full page navigation
                        window.location.href = targetUrl;
                      }}
                      className="btn btn-ghost btn-xs sm:btn-sm p-1 sm:p-2"
                      title="Back to client"
                    >
                      <ArrowLeftIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <span className="badge badge-sm sm:badge-md bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">Draft</span>
                  </>
                )}
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    <span className="text-xs sm:text-lg font-bold text-gray-900">{client?.name || 'Client'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ClipboardDocumentIcon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    <span className="text-xs sm:text-lg font-bold text-gray-900">Lead #{renderLeadNumber()}</span>
                  </div>
                  {(() => {
                    const displayCategory = getCategoryDisplayName(client?.category_id, client?.category);
                    return displayCategory ? (
                      <div className="flex items-center gap-1.5 hidden sm:flex">
                        <TagIcon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                        <span className="text-xs sm:text-lg font-bold text-gray-900">{displayCategory}</span>
                      </div>
                    ) : null;
                  })()}
                  {client?.topic && (
                    <div className="flex items-center gap-1.5">
                      <DocumentTextIcon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                      <span className="text-xs sm:text-lg font-bold text-gray-900">{client.topic}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full px-2 sm:px-6 py-8 pb-24 xl:pb-20 print-content-wrapper">
        <div className="relative min-h-screen">
          {/* Contract Content */}
          <div className="w-full transition-all duration-300 xl:pr-[280px]">
            <div ref={contractContentRef} id="contract-print-area" className="text-gray-900 leading-relaxed [&_.ProseMirror_p]:mb-3 [&_p]:mb-3 text-sm sm:text-base [&_*]:text-sm sm:[&_*]:text-base">
              {editing ? (
                <>
                  {/* Editor Toolbar with Field Insertion - Fixed at top */}
                  <div className="sticky top-0 z-30 flex flex-wrap gap-2 items-center mb-4 p-4 rounded-xl border border-gray-300 bg-gray-50 print-hide shadow-md backdrop-blur-sm bg-white/95">
                    {/* Formatting buttons */}
                    <button className={`btn btn-sm ${editor.isActive('bold') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { editor.chain().focus().toggleBold().run(); setTimeout(() => editor.commands.focus(), 10); }} title="Bold"><b className="text-base font-bold">B</b></button>
                    <button className={`btn btn-sm ${editor.isActive('italic') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { editor.chain().focus().toggleItalic().run(); setTimeout(() => editor.commands.focus(), 10); }} title="Italic"><i className="text-base italic">I</i></button>
                    <button className={`btn btn-sm ${editor.isActive('underline') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { editor.chain().focus().toggleUnderline().run(); setTimeout(() => editor.commands.focus(), 10); }} title="Underline"><u className="text-base underline">U</u></button>
                    <button className={`btn btn-sm ${editor.isActive('strike') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { editor.chain().focus().toggleStrike().run(); setTimeout(() => editor.commands.focus(), 10); }} title="Strikethrough"><s className="text-base line-through">S</s></button>


                    {/* Font Family Dropdown */}
                    <select
                      className="select select-sm select-bordered"
                      style={{ minWidth: '100px', width: '100px' }}
                      value={editor.getAttributes('fontFamily').fontFamily || 'Arial'}
                      onChange={(e) => {
                        const value = e.target.value;
                        editor.chain().focus().setFontFamily(value).run();
                        setTimeout(() => editor.commands.focus(), 10);
                      }}
                      title="Font Family"
                    >
                      <option value="Arial">Arial</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Courier New">Courier New</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Comic Sans MS">Comic Sans MS</option>
                      <option value="Impact">Impact</option>
                      <option value="Trebuchet MS">Trebuchet MS</option>
                    </select>

                    {/* Font Size Dropdown */}
                    <select
                      className="select select-sm select-bordered"
                      style={{ minWidth: '90px', width: '90px' }}
                      value={editor.getAttributes('fontSize').fontSize || '16px'}
                      onChange={(e) => {
                        const value = e.target.value;
                        editor.chain().focus().setFontSize(value).run();
                        setTimeout(() => editor.commands.focus(), 10);
                      }}
                      title="Font Size"
                    >
                      <option value="8px">8px</option>
                      <option value="10px">10px</option>
                      <option value="12px">12px</option>
                      <option value="14px">14px</option>
                      <option value="16px">16px</option>
                      <option value="18px">18px</option>
                      <option value="20px">20px</option>
                      <option value="24px">24px</option>
                      <option value="28px">28px</option>
                      <option value="32px">32px</option>
                      <option value="36px">36px</option>
                      <option value="48px">48px</option>
                    </select>

                    {/* Undo/Redo */}
                    <button className="btn btn-sm btn-ghost" onClick={() => { editor.chain().focus().undo().run(); setTimeout(() => editor.commands.focus(), 10); }} title="Undo"><span className="text-lg">⎌</span></button>
                    <button className="btn btn-sm btn-ghost" onClick={() => { editor.chain().focus().redo().run(); setTimeout(() => editor.commands.focus(), 10); }} title="Redo"><span className="text-lg">⎌⎌</span></button>

                    {/* Add Text Field Button */}
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        if (!editor) return;

                        // Find the highest text field ID in the content
                        const content = editor.getJSON();
                        let highestId = 0;
                        const findHighestId = (node: any) => {
                          if (node.type === 'text' && node.text) {
                            // Match {{text:text-1}}, {{text:text-2}}, etc.
                            const matches = node.text.match(/\{\{text:text-(\d+)\}\}/g);
                            if (matches) {
                              matches.forEach((match: string) => {
                                const idMatch = match.match(/text-(\d+)/);
                                if (idMatch) {
                                  const id = parseInt(idMatch[1], 10);
                                  if (id > highestId) {
                                    highestId = id;
                                  }
                                }
                              });
                            }
                          }
                          if (node.content) {
                            if (Array.isArray(node.content)) {
                              node.content.forEach(findHighestId);
                            } else {
                              findHighestId(node.content);
                            }
                          }
                        };
                        findHighestId(content);

                        // Create new field ID (highest + 1)
                        const newFieldId = highestId + 1;
                        const placeholder = `{{text:text-${newFieldId}}}`;

                        // Insert the placeholder at the current cursor position and maintain focus
                        editor.chain().focus().insertContent(placeholder).run();
                        // Ensure focus is maintained after insertion
                        setTimeout(() => {
                          editor.commands.focus();
                        }, 10);
                      }}
                      title="Add extra field"
                    >
                      <PlusIcon className="w-4 h-4" />
                      <span className="ml-1">Add extra field</span>
                    </button>
                  </div>
                  {/* Render editor content - placeholders show as plain text in edit mode */}
                  <div
                    key={`edit-content-${editorContentKey}-${renderKey}`}
                    style={{
                      position: 'relative',
                      minHeight: '400px'
                    }}
                  >
                    <EditorContent editor={editor} />
                  </div>
                </>
              ) : status === 'signed' ? (
                // For signed contracts, show the filled-in content using custom rendering
                <div key={`signed-${renderKey}-${customPricing?.final_amount}-${customPricing?.applicant_count}`}>
                  {contract.custom_content ? (
                    (() => {
                      console.log('🔍 Signed contract.custom_content:', contract.custom_content);
                      return renderSignedContractContent(contract.custom_content);
                    })()
                  ) : (
                    (() => {
                      console.log('🎯 Rendering signed template.content:', template.content);
                      return renderTiptapContent(template.content, '', false, undefined, undefined, undefined, true, { text: 0, signature: 0 });
                    })()
                  )}
                </div>
              ) : (
                // For non-signed contracts, use renderTiptapContent to show placeholders as input fields
                // Key includes pricing tiers hash to force re-render when any tier price changes
                <div key={`readonly-${renderKey}-${template?.id || 'no-template'}-${contract?.template_id || contract?.custom_pricing?.legacy_template_id || 'no-id'}-${customPricing?.final_amount || 0}-${customPricing?.applicant_count || 0}-${customPricing?.pricing_tiers ? Object.values(customPricing.pricing_tiers).join('-') : ''}`}>
                  {(() => {
                    // Get content from contract.custom_content (saved content) or template content
                    let contentToRender = contract?.custom_content || template?.content;

                    // Process content to fill placeholders but keep {{text}}, {{date}}, and {{signature}}
                    if (contentToRender && customPricing && client) {
                      const processedContent = fillPlaceholdersInTiptapContent(
                        JSON.parse(JSON.stringify(contentToRender)),
                        customPricing,
                        client,
                        contract,
                        editing,
                        { current: 0 }
                      );
                      return renderTiptapContent(processedContent, '', false, signaturePads, undefined, undefined, !editing, { text: 0, signature: 0 });
                    }
                    return renderTiptapContent(contentToRender || { type: 'doc', content: [] }, '', false, signaturePads, undefined, undefined, !editing, { text: 0, signature: 0 });
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar - Fixed to right edge of viewport - Only show button, no background */}
          {!showDetailsAndPricingModal && (
            <>
              {/* Desktop buttons */}
              <div
                className="fixed top-0 right-0 z-[60] transition-all duration-300 ease-in-out hidden xl:block print-hide"
                style={{
                  top: `${headerHeight + 32}px`,
                  paddingRight: '16px',
                  height: `calc(100vh - ${headerHeight + 32}px)`
                }}
              >
                <div className="flex flex-col h-full relative">
                  <div className="flex flex-col gap-3">
                    {/* Button to open Contract Details & Pricing Modal */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowDetailsAndPricingModal(true)}
                        className="btn btn-circle btn-primary"
                        title="Contract Details & Pricing"
                      >
                        <Cog6ToothIcon className="w-6 h-6" />
                      </button>
                      <span className="text-sm text-black font-medium">Pricing</span>
                    </div>

                    {/* Share button */}
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-circle btn-primary"
                        onClick={handleShareContractLink}
                        title="Copy public contract link"
                        style={{ backgroundColor: '#4218CC' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3414A3'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#4218CC'}
                      >
                        <ShareIcon className="w-6 h-6" />
                      </button>
                      <span className="text-sm text-black font-medium">Share</span>
                    </div>

                    {!editing && status === 'draft' && (
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-circle btn-outline"
                          onClick={() => {
                            setEditing(true);
                            // Focus editor after entering edit mode
                            setTimeout(() => {
                              if (editor) {
                                editor.commands.focus();
                              }
                            }, 100);
                          }}
                        >
                          <PencilIcon className="w-6 h-6" />
                        </button>
                        <span className="text-sm text-black font-medium">Edit</span>
                      </div>
                    )}

                    {editing && (
                      <>
                        <div className="flex items-center gap-2">
                          <button
                            className="btn btn-circle btn-primary"
                            onClick={handleSaveEdit}
                          >
                            <CheckIcon className="w-6 h-6" />
                          </button>
                          <span className="text-sm text-black font-medium">Save</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="btn btn-circle bg-white border border-gray-300 hover:bg-gray-50"
                            onClick={async () => {
                              setEditing(false);
                              // Reload contract content to discard changes without full page reload
                              if (contract?.id && editor) {
                                const { data: contractData } = await supabase
                                  .from('contracts')
                                  .select('*, contract_templates(*)')
                                  .eq('id', contract.id)
                                  .single();
                                if (contractData) {
                                  // Update contract state - this will trigger the useEffect to reprocess content
                                  setContract(contractData);
                                  // Force content reprocessing by incrementing renderKey
                                  setRenderKey(prev => prev + 1);
                                }
                              }
                            }}
                          >
                            <XMarkIcon className="w-6 h-6" />
                          </button>
                          <span className="text-sm text-black font-medium">Cancel</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Closer Role, Applicants, and Total Value */}
                  <div className="mt-6 pt-6 space-y-4">
                    {/* Closer Role */}
                    {(() => {
                      if (!client) return null;
                      const isLegacyLead = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
                      let closerId: string | number | null = null;

                      if (isLegacyLead) {
                        // For legacy leads, check closer_id first, then closer field
                        closerId = (client as any).closer_id || (client as any).closer || null;
                      } else {
                        // For new leads, check closer field
                        const closer = client.closer;
                        if (closer && closer !== '---' && closer !== '--' && closer !== null) {
                          if (/^\d+$/.test(String(closer).trim())) {
                            closerId = Number(closer);
                          } else {
                            // It's a display name, find the employee
                            const employee = allEmployees.find((emp: any) =>
                              emp.display_name && emp.display_name.trim().toLowerCase() === String(closer).trim().toLowerCase()
                            );
                            closerId = employee?.id || null;
                          }
                        }
                        // Also check if there's a closer_id field for new leads
                        if (!closerId && (client as any).closer_id) {
                          closerId = (client as any).closer_id;
                        }
                      }

                      const closerDisplay = getEmployeeDisplayNameFromId(closerId);
                      if (!closerId || closerDisplay === '---' || closerDisplay === '') return null;

                      return (
                        <div className="flex flex-col items-start">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold h-4 leading-4 mb-1">Closer</p>
                          <div className="flex items-center gap-2 h-12">
                            <EmployeeAvatar employeeId={closerId} size="md" />
                            <p className="font-medium truncate text-sm leading-5">{closerDisplay}</p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Applicants Number */}
                    {(() => {
                      const applicantCount = customPricing?.applicant_count || contract?.applicant_count || 0;
                      if (!applicantCount || applicantCount === 0) return null;

                      return (
                        <div className="flex flex-col items-start">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold h-4 leading-4 mb-1">Applicants</p>
                          <div className="flex items-center gap-2">
                            <span className="badge badge-sm badge-ghost font-medium text-xs px-2 py-0.5 border-gray-200 text-gray-600">
                              {applicantCount} {applicantCount === 1 ? 'Applicant' : 'Applicants'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Total Value with VAT */}
                    {(() => {
                      if (!client || !customPricing) return null;

                      const isLegacyLead = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');

                      // 1. Currency Resolution
                      let currency = '';
                      if (client?.currency_id) {
                        const currencyFromId = getCurrencyName(client.currency_id);
                        if (currencyFromId && currencyFromId.trim() !== '' && currencyFromId !== '₪') {
                          currency = currencyFromId;
                        }
                      }
                      if (isLegacyLead && (client as any)?.currency_id && !currency) {
                        const currencyFromId = getCurrencyName((client as any).currency_id);
                        if (currencyFromId && currencyFromId.trim() !== '' && currencyFromId !== '₪') {
                          currency = currencyFromId;
                        }
                      }
                      if (!currency) {
                        currency = client?.proposal_currency ?? client?.balance_currency ?? customPricing?.currency ?? '';
                      }
                      if (!currency || currency.trim() === '') {
                        const defaultCurrency = allCurrencies.find((curr: any) => {
                          if (!curr || !curr.id) return false;
                          const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
                          const currIdNum = typeof currId === 'string' ? parseInt(currId, 10) : Number(currId);
                          return !isNaN(currIdNum) && currIdNum === 1;
                        });
                        currency = (defaultCurrency && defaultCurrency.name && defaultCurrency.name.trim() !== '')
                          ? defaultCurrency.name.trim()
                          : '₪';
                      }

                      // 2. Base Amount
                      let baseAmount: number;
                      if (isLegacyLead) {
                        const currencyId = (client as any)?.currency_id;
                        let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                        if (!numericCurrencyId || isNaN(numericCurrencyId)) numericCurrencyId = 1;

                        if (numericCurrencyId === 1) {
                          baseAmount = Number((client as any)?.total_base ?? 0);
                        } else {
                          baseAmount = Number((client as any)?.total ?? 0);
                        }
                      } else {
                        baseAmount = Number(client?.balance || client?.proposal_total || customPricing?.total_amount || 0);
                      }

                      // 3. Subcontractor Fee & Net Amount
                      const subcontractorFee = Number(client?.subcontractor_fee ?? 0);
                      const mainAmount = baseAmount - subcontractorFee;

                      // 4. VAT
                      let vatAmount = 0;
                      let shouldShowVAT = false;
                      const vatValue = client?.vat;

                      if (isLegacyLead) {
                        shouldShowVAT = true;
                        if (vatValue !== null && vatValue !== undefined) {
                          const vatStr = String(vatValue).toLowerCase().trim();
                          if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                        }
                        if (shouldShowVAT) {
                          vatAmount = baseAmount * 0.18;
                        }
                      } else {
                        shouldShowVAT = true;
                        if (vatValue !== null && vatValue !== undefined) {
                          const vatStr = String(vatValue).toLowerCase().trim();
                          if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                        }

                        if (shouldShowVAT) {
                          if (client?.vat_value && Number(client.vat_value) > 0) {
                            vatAmount = Number(client.vat_value);
                          } else {
                            vatAmount = baseAmount * 0.18;
                          }
                        }
                      }

                      if (mainAmount === 0 && vatAmount === 0) return null;

                      return (
                        <div className="flex flex-col items-start">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold h-4 leading-4 mb-1">Total Value</p>
                          <div className="space-y-1">
                            <div className="flex items-end gap-2">
                              <p className="text-2xl font-bold text-gray-900 leading-none tracking-tight">
                                {currency}{Number(mainAmount.toFixed(2)).toLocaleString()}
                              </p>
                              {shouldShowVAT && vatAmount > 0 && (
                                <p className="text-sm text-gray-600 pb-1">
                                  +{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} VAT
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Call and Email Icons - At the bottom, aligned with bottom bar */}
                  <div className="absolute w-full pt-6 space-y-3 flex-shrink-0" style={{ bottom: '80px' }}>
                    {/* Call Icon */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          if (!client) return;
                          setShowCallContactModal(true);
                          setLoadingContacts(true);
                          try {
                            const isLegacyLead = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
                            const leadId = isLegacyLead
                              ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
                              : client.id;
                            const contacts = await fetchLeadContacts(leadId, isLegacyLead);
                            // Filter contacts with phone numbers
                            const contactsWithPhone = contacts.filter(c => (c.phone || c.mobile) && (c.phone?.trim() || c.mobile?.trim()));
                            setAvailableContacts(contactsWithPhone.length > 0 ? contactsWithPhone : contacts);
                          } catch (error) {
                            console.error('Error fetching contacts:', error);
                            setAvailableContacts([]);
                          } finally {
                            setLoadingContacts(false);
                          }
                        }}
                        className="btn btn-circle btn-primary"
                        title="Call"
                      >
                        <PhoneIcon className="w-6 h-6" />
                      </button>
                      <span className="text-sm text-black font-medium">Call</span>
                    </div>

                    {/* Email Icon */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          if (!client) return;
                          setShowEmailContactModal(true);
                          setLoadingContacts(true);
                          try {
                            const isLegacyLead = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
                            const leadId = isLegacyLead
                              ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
                              : client.id;
                            const contacts = await fetchLeadContacts(leadId, isLegacyLead);
                            // Filter contacts with emails
                            const contactsWithEmail = contacts.filter(c => c.email && c.email.trim());
                            setAvailableContacts(contactsWithEmail.length > 0 ? contactsWithEmail : contacts);
                          } catch (error) {
                            console.error('Error fetching contacts:', error);
                            setAvailableContacts([]);
                          } finally {
                            setLoadingContacts(false);
                          }
                        }}
                        className="btn btn-circle btn-primary"
                        title="Email"
                      >
                        <EnvelopeIcon className="w-6 h-6" />
                      </button>
                      <span className="text-sm text-black font-medium">Email</span>
                    </div>
                  </div>
                </div>
              </div>

            </>
          )}

          {/* Mobile Sidebar - Normal layout on mobile */}
          {/* Mobile code removed - use modal component instead */}

        </div>
      </div>

      {/* Contract Details & Pricing Modal */}
      <ContractDetailsAndPricingModal
        isOpen={showDetailsAndPricingModal}
        onClose={() => setShowDetailsAndPricingModal(false)}
        contract={contract}
        customPricing={customPricing}
        setCustomPricing={setCustomPricing}
        template={template}
        status={status}
        currencyType={currencyType}
        setCurrencyType={setCurrencyType}
        subCurrency={subCurrency}
        setSubCurrency={setSubCurrency}
        vatIncluded={vatIncluded}
        setVatIncluded={setVatIncluded}
        handleApplicantCountChange={handleApplicantCountChange}
        handleTierPriceChange={handleTierPriceChange}
        handlePaymentPlanChange={handlePaymentPlanChange}
        handleDeletePaymentRow={handleDeletePaymentRow}
        handleAddPaymentRow={handleAddPaymentRow}
        handleSaveCustomPricing={handleSaveCustomPricing}
        handleDeleteContract={handleDeleteContract}
        isSaving={isSaving}
        discountOptions={discountOptions}
        updateCustomPricing={updateCustomPricing}
      />

      {/* Change Template Modal */}
      {showChangeTemplateModal && (
        <div
          className={`fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 pt-8 sm:pt-16 ${showTemplateDropdown ? 'overflow-visible' : ''
            }`}
          onClick={() => {
            setShowChangeTemplateModal(false);
            setTemplateSearchQuery('');
            setTemplateLanguageFilter(null);
          }}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col transition-all duration-200 ${showTemplateDropdown ? 'max-h-[75vh] overflow-visible' : 'max-h-[70vh] overflow-hidden'
              }`}
            onClick={(e) => e.stopPropagation()}
            style={showTemplateDropdown ? { overflow: 'visible' } : {}}
          >
            <div className="p-6 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">Change Contract Template</h2>
                <button
                  onClick={() => {
                    setShowChangeTemplateModal(false);
                    setTemplateSearchQuery('');
                    setTemplateLanguageFilter(null);
                  }}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className={`p-6 flex-1 min-h-0 ${showTemplateDropdown ? 'overflow-visible' : 'overflow-y-auto'}`}>
              {/* Language Filter */}
              <div className="mb-4">
                <select
                  className="select select-bordered w-full"
                  value={templateLanguageFilter || ''}
                  onChange={(e) => {
                    setTemplateLanguageFilter(e.target.value || null);
                    setShowTemplateDropdown(true);
                  }}
                >
                  <option value="">All Languages</option>
                  {availableLanguages.map(lang => (
                    <option key={lang.id} value={String(lang.id)}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative mb-4">
                <input
                  type="text"
                  placeholder="Search templates..."
                  className="input input-bordered w-full"
                  value={
                    contract?.template_id && !templateSearchQuery
                      ? availableTemplates.find(t => t.id === contract.template_id)?.name || ''
                      : templateSearchQuery
                  }
                  onChange={(e) => {
                    setTemplateSearchQuery(e.target.value);
                    setShowTemplateDropdown(true);
                  }}
                  onFocus={() => setShowTemplateDropdown(true)}
                  onBlur={() => setTimeout(() => setShowTemplateDropdown(false), 200)}
                />
                {showTemplateDropdown && availableTemplates
                  .filter(t => {
                    // Filter by search query
                    const matchesSearch = !templateSearchQuery.trim() || t.name.toLowerCase().includes(templateSearchQuery.toLowerCase());
                    // Filter by language
                    const matchesLanguage = !templateLanguageFilter || String(t.language_id) === templateLanguageFilter;
                    return matchesSearch && matchesLanguage;
                  })
                  .length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg overflow-y-auto" style={{ maxHeight: '400px', top: '100%' }}>
                      {availableTemplates
                        .filter(t => {
                          // Filter by search query
                          const matchesSearch = !templateSearchQuery.trim() || t.name.toLowerCase().includes(templateSearchQuery.toLowerCase());
                          // Filter by language
                          const matchesLanguage = !templateLanguageFilter || String(t.language_id) === templateLanguageFilter;
                          return matchesSearch && matchesLanguage;
                        })
                        .map(t => {
                          // Check if this template is the currently selected one
                          // For new templates: check template_id
                          // For legacy templates: check custom_pricing.legacy_template_id
                          const isLegacyTemplate = !isNaN(Number(t.id)) || t.id.toString().startsWith('legacy_');
                          const isSelected = isLegacyTemplate
                            ? contract?.custom_pricing?.legacy_template_id === t.id.toString().replace('legacy_', '')
                            : contract?.template_id === t.id;

                          return (
                            <div
                              key={t.id}
                              className={`px-4 py-2 cursor-pointer hover:bg-gray-100 ${isSelected ? 'bg-blue-50' : ''
                                }`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleTemplateChange(t.id);
                              }}
                            >
                              {t.name}
                            </div>
                          );
                        })}
                    </div>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Call Contact Selection Modal */}
      {showCallContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <PhoneIcon className="w-6 h-6 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Select Contact to Call</h2>
              </div>
              <button
                onClick={() => setShowCallContactModal(false)}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              {loadingContacts ? (
                <div className="flex items-center justify-center py-8">
                  <div className="loading loading-spinner loading-md"></div>
                </div>
              ) : availableContacts.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No contacts with phone numbers found</p>
              ) : (
                <div className="space-y-2">
                  {availableContacts.map((contact) => {
                    const phoneNumber = contact.phone || contact.mobile || '';
                    if (!phoneNumber) return null;
                    return (
                      <button
                        key={contact.id}
                        onClick={() => {
                          setCallPhoneNumber(phoneNumber);
                          setCallContactName(contact.name || client?.name || '');
                          setShowCallContactModal(false);
                          setIsCallModalOpen(true);
                        }}
                        className="w-full text-left p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        <div className="font-medium text-gray-900">{contact.name || 'Unnamed Contact'}</div>
                        <div className="text-sm text-gray-600 mt-1">{phoneNumber}</div>
                        {contact.email && (
                          <div className="text-xs text-gray-500 mt-1">{contact.email}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Email Contact Selection Modal */}
      {showEmailContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <EnvelopeIcon className="w-6 h-6 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Select Contact to Email</h2>
              </div>
              <button
                onClick={() => setShowEmailContactModal(false)}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              {loadingContacts ? (
                <div className="flex items-center justify-center py-8">
                  <div className="loading loading-spinner loading-md"></div>
                </div>
              ) : availableContacts.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No contacts with email addresses found</p>
              ) : (
                <div className="space-y-2">
                  {availableContacts.map((contact) => {
                    const email = contact.email || '';
                    if (!email) return null;
                    return (
                      <button
                        key={contact.id}
                        onClick={() => {
                          window.location.href = `mailto:${email}`;
                          setShowEmailContactModal(false);
                        }}
                        className="w-full text-left p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        <div className="font-medium text-gray-900">{contact.name || 'Unnamed Contact'}</div>
                        <div className="text-sm text-gray-600 mt-1">{email}</div>
                        {(contact.phone || contact.mobile) && (
                          <div className="text-xs text-gray-500 mt-1">{contact.phone || contact.mobile}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Call Options Modal */}
      <CallOptionsModal
        isOpen={isCallModalOpen}
        onClose={() => setIsCallModalOpen(false)}
        phoneNumber={callPhoneNumber}
        leadName={callContactName}
      />

      {/* Print-specific CSS */}
      <style>{`
        /* PDF generation mode - convert all colors to supported formats */
        .pdf-generation-mode,
        .pdf-generation-mode * {
          background-image: none !important;
        }
        .pdf-generation-mode [class*="gradient"] {
          background: #ffffff !important;
          background-color: #ffffff !important;
          background-image: none !important;
        }
        
        @media print {
          @page {
            size: A4;
            margin: 2cm;
          }
          
          /* Reset body styles */
          body,
          html {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: auto !important;
          }
          
          /* Hide non-content elements */
          .print-hide,
          header,
          button,
          [class*="sidebar"],
          [class*="Sidebar"],
          nav {
            display: none !important;
            visibility: hidden !important;
          }
          
          /* Hide everything except the contract print area */
          body > * {
            visibility: hidden !important;
          }
          
          /* Show only the contract content wrapper and its contents */
          .print-content-wrapper,
          .print-content-wrapper *,
          #contract-print-area,
          #contract-print-area * {
            visibility: visible !important;
          }
          
          /* Position contract content at top of page for print */
          .print-content-wrapper {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          
          /* Format contract content for multi-page printing */
          #contract-print-area {
            position: relative !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            page-break-inside: auto !important;
            overflow: visible !important;
            height: auto !important;
          }
          
          #contract-print-area * {
            background-image: none !important;
          }
          
          #contract-print-area [class*="gradient"] {
            background: #ffffff !important;
            background-color: #ffffff !important;
            background-image: none !important;
          }
          
          /* Page break handling for better multi-page layout */
          #contract-print-area p {
            orphans: 3;
            widows: 3;
            page-break-inside: avoid;
          }
          
          #contract-print-area h1,
          #contract-print-area h2,
          #contract-print-area h3,
          #contract-print-area h4,
          #contract-print-area h5,
          #contract-print-area h6 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }
          
          #contract-print-area img {
            page-break-inside: avoid;
            max-width: 100% !important;
          }
        }
      `}</style>

      {/* Remove default arrows from all number inputs */}
      <style>{`
        input[type=number].no-arrows::-webkit-inner-spin-button, 
        input[type=number].no-arrows::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number].no-arrows {
          -moz-appearance: textfield;
        }
        
        /* TipTap Editor Styling - Edit Mode */
        .ProseMirror {
          min-height: 100% !important;
          padding: 1.5rem;
          outline: none;
        }
        
        /* RTL support for Hebrew/Arabic text */
        .ProseMirror p[dir="rtl"],
        .ProseMirror h1[dir="rtl"],
        .ProseMirror h2[dir="rtl"],
        .ProseMirror h3[dir="rtl"],
        .ProseMirror h4[dir="rtl"],
        .ProseMirror h5[dir="rtl"],
        .ProseMirror h6[dir="rtl"],
        .ProseMirror li[dir="rtl"],
        .ProseMirror blockquote[dir="rtl"] {
          text-align: right !important;
          direction: rtl !important;
        }
        
        .ProseMirror p[dir="ltr"],
        .ProseMirror h1[dir="ltr"],
        .ProseMirror h2[dir="ltr"],
        .ProseMirror h3[dir="ltr"],
        .ProseMirror h4[dir="ltr"],
        .ProseMirror h5[dir="ltr"],
        .ProseMirror h6[dir="ltr"],
        .ProseMirror li[dir="ltr"],
        .ProseMirror blockquote[dir="ltr"] {
          text-align: left !important;
          direction: ltr !important;
        }
        
        .ProseMirror ul[dir="rtl"],
        .ProseMirror ol[dir="rtl"] {
          padding-right: 2rem;
          padding-left: 0;
          text-align: right;
          direction: rtl;
        }
        
        .ProseMirror ul[dir="ltr"],
        .ProseMirror ol[dir="ltr"] {
          padding-left: 2rem;
          padding-right: 0;
          text-align: left;
          direction: ltr;
        }
        
        /* Auto-detect direction for Hebrew/Arabic */
        .ProseMirror p,
        .ProseMirror h1,
        .ProseMirror h2,
        .ProseMirror h3,
        .ProseMirror h4,
        .ProseMirror h5,
        .ProseMirror h6 {
          unicode-bidi: plaintext;
        }
        
        /* Ensure read-only mode has identical styling to edit mode */
        .ProseMirror[contenteditable="false"] {
          padding: 0 !important;
          margin: 0 !important;
          min-height: 0 !important;
        }
        
        .ProseMirror[contenteditable="false"] p {
          margin-bottom: 0.75rem !important;
          margin-top: 0 !important;
        }
        
        .ProseMirror[contenteditable="false"] p:last-child {
          margin-bottom: 0 !important;
        }
        
        /* Style {{text}} and {{signature}} placeholders to look like input fields in view mode */
        .ProseMirror[contenteditable="false"] .text-field-placeholder {
          display: inline-block;
          min-width: 150px;
          height: 40px;
          border: 2px solid #d1d5db;
          border-radius: 8px;
          background-color: #f9fafb;
          padding: 8px 12px;
          margin: 0 4px;
          font-size: 14px;
          color: #6b7280;
          font-style: italic;
        }
        
        .ProseMirror[contenteditable="false"] .signature-placeholder {
          display: inline-block;
          min-width: 200px;
          height: 80px;
          border: 2px solid #d1d5db;
          border-radius: 8px;
          background-color: #f9fafb;
          margin: 0 4px;
          position: relative;
        }
        
        .ProseMirror[contenteditable="false"] .signature-placeholder::after {
          content: "Sign here";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: #9ca3af;
          font-size: 12px;
          font-style: italic;
        }
      `}</style>

      {/* Fixed Bottom Bar with Created Date, Template Name, Change Template Button, and Action Buttons */}
      {contract?.created_at && (
        <div className="fixed bottom-0 left-0 right-0 z-40 print-hide">
          <div className="backdrop-blur-md bg-white/95 rounded-t-2xl sm:rounded-2xl shadow-lg border-t sm:border border-white/20 px-2 sm:px-4 py-2 sm:py-3 w-full sm:w-fit sm:max-w-full sm:mx-auto sm:mb-4">
            <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
              {/* Mobile: Action buttons row */}
              <div className="flex items-center justify-around gap-1 flex-1 sm:hidden">
                {!showDetailsAndPricingModal && (
                  <>
                    {/* Button to open Contract Details & Pricing Modal */}
                    <button
                      onClick={() => setShowDetailsAndPricingModal(true)}
                      className="btn btn-circle btn-primary w-12 h-12"
                      title="Contract Details & Pricing"
                    >
                      <Cog6ToothIcon className="w-6 h-6" />
                    </button>

                    {/* Share button - Mobile uses native share */}
                    <button
                      className="btn btn-circle btn-primary w-12 h-12"
                      onClick={handleMobileShare}
                      title="Share contract link"
                      style={{ backgroundColor: '#4218CC' }}
                    >
                      <ShareIcon className="w-6 h-6" />
                    </button>

                    {!editing && status === 'draft' && (
                      <button
                        className="btn btn-circle btn-primary w-12 h-12"
                        onClick={() => {
                          setEditing(true);
                          // Focus editor after entering edit mode
                          setTimeout(() => {
                            if (editor) {
                              editor.commands.focus();
                            }
                          }, 100);
                        }}
                        title="Edit"
                      >
                        <PencilIcon className="w-6 h-6" />
                      </button>
                    )}

                    {editing && (
                      <>
                        <button
                          className="btn btn-circle btn-primary w-12 h-12"
                          onClick={handleSaveEdit}
                          title="Save"
                        >
                          <CheckIcon className="w-6 h-6" />
                        </button>
                        <button
                          className="btn btn-circle bg-white border border-gray-300 w-12 h-12 hover:bg-gray-50"
                          onClick={async () => {
                            setEditing(false);
                            // Reload contract content to discard changes without full page reload
                            if (contract?.id && editor) {
                              const { data: contractData } = await supabase
                                .from('contracts')
                                .select('*, contract_templates(*)')
                                .eq('id', contract.id)
                                .single();
                              if (contractData) {
                                // Update contract and template state - this will trigger the useEffect to reprocess content
                                setContract(contractData);
                                if (contractData.contract_templates) {
                                  setTemplate(contractData.contract_templates);
                                }
                                // Force content reprocessing by incrementing renderKey
                                setRenderKey(prev => prev + 1);
                              }
                            }
                          }}
                          title="Cancel"
                        >
                          <XMarkIcon className="w-6 h-6" />
                        </button>
                      </>
                    )}

                    {/* Change Template button on mobile */}
                    {status === 'draft' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowChangeTemplateModal(true);
                        }}
                        className="btn btn-circle btn-primary w-12 h-12"
                        title="Change Template"
                      >
                        <ClipboardDocumentIcon className="w-6 h-6" />
                      </button>
                    )}

                    {/* Delete button on mobile */}
                    <button
                      onClick={handleDeleteContract}
                      className="btn btn-circle btn-error w-12 h-12"
                      title="Delete Contract"
                    >
                      <TrashIcon className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>

              {/* Desktop: Created Date, Change Template Button, Delete Button */}
              <div className="hidden sm:flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                  <p className="text-xs sm:text-sm text-gray-600">
                    {new Date(contract.created_at).toLocaleDateString()}
                  </p>
                </div>
                {status === 'draft' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowChangeTemplateModal(true);
                    }}
                    className="btn btn-outline btn-xs sm:btn-sm btn-primary"
                  >
                    Change Template
                  </button>
                )}
                <button
                  onClick={handleDeleteContract}
                  className="btn btn-outline btn-xs sm:btn-sm btn-error"
                  title="Delete Contract"
                >
                  <TrashIcon className="w-4 h-4 sm:w-5 sm:h-5 mr-1" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContractPage; 