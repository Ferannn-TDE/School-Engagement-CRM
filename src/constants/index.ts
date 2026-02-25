export const ILLINOIS_COUNTIES = [
  'Adams', 'Alexander', 'Bond', 'Boone', 'Brown', 'Bureau', 'Calhoun',
  'Carroll', 'Cass', 'Champaign', 'Christian', 'Clark', 'Clay', 'Clinton',
  'Coles', 'Cook', 'Crawford', 'Cumberland', 'DeKalb', 'DeWitt', 'Douglas',
  'DuPage', 'Edgar', 'Edwards', 'Effingham', 'Fayette', 'Ford', 'Franklin',
  'Fulton', 'Gallatin', 'Greene', 'Grundy', 'Hamilton', 'Hancock', 'Hardin',
  'Henderson', 'Henry', 'Iroquois', 'Jackson', 'Jasper', 'Jefferson', 'Jersey',
  'Jo Daviess', 'Johnson', 'Kane', 'Kankakee', 'Kendall', 'Knox', 'Lake',
  'LaSalle', 'Lawrence', 'Lee', 'Livingston', 'Logan', 'Macon', 'Macoupin',
  'Madison', 'Marion', 'Marshall', 'Mason', 'Massac', 'McDonough', 'McHenry',
  'McLean', 'Menard', 'Mercer', 'Monroe', 'Montgomery', 'Morgan', 'Moultrie',
  'Ogle', 'Peoria', 'Perry', 'Piatt', 'Pike', 'Pope', 'Pulaski', 'Putnam',
  'Randolph', 'Richland', 'Rock Island', 'Saline', 'Sangamon', 'Schuyler',
  'Scott', 'Shelby', 'St. Clair', 'Stark', 'Stephenson', 'Tazewell', 'Union',
  'Vermilion', 'Wabash', 'Warren', 'Washington', 'Wayne', 'White', 'Whiteside',
  'Will', 'Williamson', 'Winnebago', 'Woodford',
] as const;

export const PAGINATION_OPTIONS = [25, 50, 100] as const;

export const CONTACT_FIELD_OPTIONS = [
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'role', label: 'Role' },
  { value: 'schoolId', label: 'School' },
  { value: 'notes', label: 'Notes' },
] as const;

export const SCHOOL_FIELD_OPTIONS = [
  { value: 'name', label: 'School Name' },
  { value: 'district', label: 'District' },
  { value: 'county', label: 'County' },
  { value: 'address', label: 'Address' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'zipCode', label: 'Zip Code' },
  { value: 'schoolType', label: 'School Type' },
] as const;
