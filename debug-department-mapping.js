require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase URL or Service Key is not set in environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugDepartmentMapping() {
  console.log('🔍 Debugging department mapping...\n');

  try {
    // 1. Check departments
    console.log('1. DEPARTMENTS:');
    const { data: departments, error: deptError } = await supabase
      .from('tenant_departement')
      .select('id, name')
      .order('name');
    
    if (deptError) {
      console.error('❌ Error fetching departments:', deptError);
    } else {
      console.log(`Found ${departments?.length || 0} departments:`);
      departments?.forEach(dept => {
        console.log(`  - ID: ${dept.id}, Name: "${dept.name}"`);
      });
    }

    console.log('\n2. MAIN CATEGORIES:');
    const { data: mainCategories, error: mainError } = await supabase
      .from('misc_maincategory')
      .select('id, name, department_id')
      .order('name');
    
    if (mainError) {
      console.error('❌ Error fetching main categories:', mainError);
    } else {
      console.log(`Found ${mainCategories?.length || 0} main categories:`);
      mainCategories?.forEach(mc => {
        const deptName = departments?.find(d => d.id === mc.department_id)?.name || 'NOT FOUND';
        console.log(`  - ID: ${mc.id}, Name: "${mc.name}", Department ID: ${mc.department_id} (${deptName})`);
      });
    }

    console.log('\n3. CATEGORIES:');
    const { data: categories, error: catError } = await supabase
      .from('misc_category')
      .select('id, name, parent_id')
      .order('name')
      .limit(20); // Limit to first 20 for readability
    
    if (catError) {
      console.error('❌ Error fetching categories:', catError);
    } else {
      console.log(`Found ${categories?.length || 0} categories (showing first 20):`);
      categories?.forEach(cat => {
        const mainCatName = mainCategories?.find(mc => mc.id === cat.parent_id)?.name || 'NOT FOUND';
        console.log(`  - ID: ${cat.id}, Name: "${cat.name}", Parent ID: ${cat.parent_id} (${mainCatName})`);
      });
    }

    console.log('\n4. MAPPING RELATIONSHIPS (using SQL JOINs):');
    
    // Use SQL JOIN to get the complete mapping
    const { data: categoryMappingData, error: mappingError } = await supabase
      .from('misc_category')
      .select(`
        id,
        name,
        parent_id,
        misc_maincategory!parent_id (
          id,
          name,
          department_id,
          tenant_departement!department_id (
            id,
            name
          )
        )
      `)
      .order('name');
    
    if (mappingError) {
      console.error('❌ Error fetching category mapping with JOINs:', mappingError);
    } else {
      let validMappings = 0;
      console.log(`Found ${categoryMappingData?.length || 0} categories with JOIN data:`);
      
      categoryMappingData?.forEach(category => {
        if (category.misc_maincategory) {
          const mainCategory = category.misc_maincategory;
          if (mainCategory.tenant_departement) {
            const department = mainCategory.tenant_departement;
            console.log(`✅ "${category.name}" -> "${mainCategory.name}" -> "${department.name}"`);
            validMappings++;
          } else {
            console.log(`❌ Category "${category.name}" -> Main Category "${mainCategory.name}" -> No Department`);
          }
        } else {
          console.log(`⚠️ Category "${category.name}" has no main category (parent_id: ${category.parent_id})`);
        }
      });
      
      console.log(`\nValid mappings found: ${validMappings}`);
    }

    console.log(`\n📊 SUMMARY:`);
    console.log(`- Departments: ${departments?.length || 0}`);
    console.log(`- Main Categories: ${mainCategories?.length || 0}`);
    console.log(`- Categories: ${categories?.length || 0}`);
    console.log(`- Valid Mappings: ${validMappings}`);

    // 5. Check some sample meetings
    console.log('\n5. SAMPLE MEETINGS:');
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select(`
        id, meeting_date, meeting_time,
        lead:leads!client_id(
          id, name, lead_number, category
        )
      `)
      .eq('meeting_date', '2025-09-16')
      .limit(5);
    
    if (meetingsError) {
      console.error('❌ Error fetching meetings:', meetingsError);
    } else {
      console.log(`Found ${meetings?.length || 0} meetings for today:`);
      meetings?.forEach(meeting => {
        const category = meeting.lead?.category || 'NO CATEGORY';
        console.log(`  - Meeting ${meeting.id}: Category "${category}"`);
      });
    }

  } catch (error) {
    console.error('❌ Error in debug script:', error);
  }
}

debugDepartmentMapping();
