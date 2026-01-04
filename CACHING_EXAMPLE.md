# How to Prevent Data Refetching - Step by Step Example

## The Problem

When you navigate back to a page, React Router unmounts and remounts the component, causing all `useEffect` hooks to run again and refetch data.

## The Solution

Replace `useEffect` + `useState` data fetching with the `useCachedFetch` hook.

---

## Example: CalendarPage Migration

### Step 1: Import the hook

```tsx
import { useCachedFetch } from "../hooks/useCachedFetch";
```

### Step 2: Find the data fetching useEffect

Look for the main `useEffect` that fetches data on mount (around line 1124 in CalendarPage.tsx).

### Step 3: Replace useState + useEffect with useCachedFetch

**BEFORE:**

```tsx
const [meetings, setMeetings] = useState<any[]>([]);
const [isLoading, setIsLoading] = useState(true);
const [allEmployees, setAllEmployees] = useState<any[]>([]);
const [allCategories, setAllCategories] = useState<any[]>([]);

useEffect(() => {
  const fetchMeetingsAndStaff = async () => {
    setIsLoading(true);

    // Fetch employees
    const { data: employeesData, error: employeesError } = await supabase
      .from("users")
      .select(`...`)
      .eq("is_active", true);

    if (!employeesError && employeesData) {
      // Process employees...
      setAllEmployees(processedEmployees);
    }

    // Fetch categories
    const { data: categoriesData } = await supabase
      .from("misc_category")
      .select(`...`);

    if (categoriesData) {
      setAllCategories(categoriesData);
    }

    // Fetch meetings...
    setMeetings(meetingsData);
    setIsLoading(false);
  };

  fetchMeetingsAndStaff();
}, []);
```

**AFTER:**

```tsx
// Use useCachedFetch for the main data fetch
const { data: calendarData, loading: isLoading } = useCachedFetch(
  "calendar-main-data",
  async () => {
    // Fetch employees
    const { data: employeesData, error: employeesError } = await supabase
      .from("users")
      .select(`...`)
      .eq("is_active", true);

    if (employeesError) throw employeesError;

    // Process employees
    const processedEmployees = employeesData
      .filter((user) => user.tenants_employee && user.email)
      .map((user) => {
        const employee = user.tenants_employee as any;
        return {
          id: employee.id,
          display_name: employee.display_name,
          bonuses_role: employee.bonuses_role,
        };
      })
      .sort((a, b) => a.display_name.localeCompare(b.display_name));

    // Deduplicate
    const uniqueEmployeesMap = new Map();
    processedEmployees.forEach((emp) => {
      if (!uniqueEmployeesMap.has(emp.id)) {
        uniqueEmployeesMap.set(emp.id, emp);
      }
    });
    const allEmployees = Array.from(uniqueEmployeesMap.values());

    // Fetch categories
    const { data: categoriesData, error: categoriesError } = await supabase
      .from("misc_category")
      .select(`...`)
      .order("name", { ascending: true });

    if (categoriesError) throw categoriesError;

    // Fetch meetings (your existing meeting fetch logic)
    // ...

    // Return all data as an object
    return {
      employees: allEmployees,
      categories: categoriesData || [],
      meetings: meetingsData || [],
      // ... any other data you need
    };
  }
);

// Extract data from the cached result
const allEmployees = calendarData?.employees || [];
const allCategories = calendarData?.categories || [];
const meetings = calendarData?.meetings || [];
```

### Step 4: Update component to use the cached data

Replace all references to `setAllEmployees`, `setAllCategories`, `setMeetings` with the data from `calendarData`.

---

## Key Points

1. **Single fetch function**: Wrap ALL your initial data fetching into ONE `useCachedFetch` call that returns an object with all the data.

2. **Cache key**: Use a unique key like `'calendar-main-data'` per page.

3. **Return object**: The fetch function should return an object containing all the data you need.

4. **Destructure**: Extract the data from the cached result: `const employees = calendarData?.employees || [];`

5. **No more setState**: You don't need `setAllEmployees`, `setMeetings`, etc. - the hook handles state.

---

## Testing

1. Navigate to Calendar page - data fetches normally
2. Navigate to another page
3. Use browser back button
4. **Result**: Calendar page loads INSTANTLY with cached data (check Network tab - no new requests!)

---

## For Complex Pages with Multiple Independent Fetches

If you have multiple independent data fetches, use multiple `useCachedFetch` calls:

```tsx
const { data: employees } = useCachedFetch(
  "calendar-employees",
  fetchEmployees
);
const { data: categories } = useCachedFetch(
  "calendar-categories",
  fetchCategories
);
const { data: meetings } = useCachedFetch("calendar-meetings", fetchMeetings);
```

But prefer combining them into one fetch if possible (fewer cache lookups, better performance).
