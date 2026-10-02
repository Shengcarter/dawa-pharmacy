/** Demo catalogue for a neighbourhood pharmacy in Dar es Salaam. Prices in TZS per selling unit. */
export const CATEGORIES = [
  ['Analgesics & Antipyretics', 'Pain and fever relief'],
  ['Antibiotics', 'Prescription-only antibacterials'],
  ['Antimalarials', 'Malaria treatment'],
  ['Antihistamines & Allergy', null],
  ['Gastrointestinal', 'Acid, ulcer and digestive care'],
  ['Cough, Cold & Flu', null],
  ['Rehydration', 'Oral rehydration and zinc'],
  ['Vitamins & Supplements', null],
  ['Cardiovascular & Diabetes', 'Chronic-care medicines'],
  ['Dermatology', 'Creams, ointments and skin care'],
  ['Antiseptics & First Aid', null],
  ['Eye & Ear Care', null],
  ['Medical Devices', null],
  ['Personal Care', null],
] as const;

export const MANUFACTURERS = [
  ['Kibo Pharmaceuticals', 'Tanzania'],
  ['Zanzi Healthcare', 'Tanzania'],
  ['Mwanza Pharma Labs', 'Tanzania'],
  ['Rift Valley Generics', 'Kenya'],
  ['Indus Lifesciences', 'India'],
  ['Nile Biotech', 'Uganda'],
  ['Lakeview Medical Devices', 'China'],
  ['Coastal Care Products', 'Tanzania'],
] as const;

export const SUPPLIERS = [
  { name: 'Msasani Pharmaceutical Distributors Ltd', contactPerson: 'Peter Massawe', phone: '+255 713 402 118', email: 'orders@msasanipharma.co.tz', address: 'Plot 22, Old Bagamoyo Road, Msasani, Dar es Salaam', tin: '104-332-871', paymentTermsDays: 30, creditLimit: 25_000_000 },
  { name: 'Kariakoo Medical Supplies', contactPerson: 'Aisha Mohamed', phone: '+255 754 889 210', email: 'sales@kariakoomed.co.tz', address: 'Msimbazi Street, Kariakoo, Dar es Salaam', tin: '112-908-450', paymentTermsDays: 14, creditLimit: 10_000_000 },
  { name: 'Arusha Pharma Wholesalers', contactPerson: 'Daniel Laizer', phone: '+255 768 115 903', email: 'info@arushapharma.co.tz', address: 'Sokoine Road, Arusha', tin: '120-776-019', paymentTermsDays: 45, creditLimit: 15_000_000 },
  { name: 'MedPlus Distributors Tanzania', contactPerson: 'Lucy Mrema', phone: '+255 715 600 742', email: 'accounts@medplus.co.tz', address: 'Nyerere Road, Dar es Salaam', tin: '131-224-665', paymentTermsDays: 30, creditLimit: 20_000_000 },
] as const;

export interface DemoProduct {
  sku: string;
  name: string;
  generic: string | null;
  brand: string | null;
  type: string;
  category: string;
  manufacturer: string;
  supplier: number; // index into SUPPLIERS
  form: string | null;
  strength: string | null;
  unit: string;
  pack: number;
  cost: number;
  price: number;
  min?: number;
  reorder: number;
  max?: number;
  rx?: boolean;
  tax?: number;
  tracked?: boolean;
  storage?: string;
  /** Price for a whole pack (pack units), when the pharmacy sells boxes as well as single units. */
  packPrice?: number;
  /** Relative sales weight in the demo history. */
  pop: number;
  /** Demo scenario: 'low' ends below reorder level, 'out' sells out, 'expired' keeps an expired batch. */
  scenario?: 'low' | 'out' | 'expired' | 'expiring';
  barcode?: string;
}

export const PRODUCTS: DemoProduct[] = [
  { sku: 'PAR-500-T', name: 'Paracetamol 500mg Tablets', generic: 'Paracetamol', brand: 'Kibodol', type: 'tablet', category: 'Analgesics & Antipyretics', manufacturer: 'Kibo Pharmaceuticals', supplier: 0, form: 'Tablet', strength: '500mg', unit: 'strip', pack: 10, cost: 350, price: 700, min: 600, reorder: 60, max: 400, packPrice: 6500, pop: 14, barcode: '6201234500017', storage: 'Store below 30°C in a dry place.' },
  { sku: 'AMX-500-C', name: 'Amoxicillin 500mg Capsules', generic: 'Amoxicillin', brand: 'Amoxil-K', type: 'capsule', category: 'Antibiotics', manufacturer: 'Indus Lifesciences', supplier: 0, form: 'Capsule', strength: '500mg', unit: 'strip', pack: 10, cost: 1200, price: 2500, min: 2200, reorder: 30, max: 200, rx: true, pop: 5, barcode: '6201234500024', scenario: 'low', storage: 'Store below 25°C. Keep away from moisture.' },
  { sku: 'IBU-400-T', name: 'Ibuprofen 400mg Tablets', generic: 'Ibuprofen', brand: 'Brufen-Z', type: 'tablet', category: 'Analgesics & Antipyretics', manufacturer: 'Zanzi Healthcare', supplier: 1, form: 'Film-coated tablet', strength: '400mg', unit: 'strip', pack: 10, cost: 500, price: 1000, min: 900, reorder: 40, max: 250, packPrice: 9000, pop: 8, barcode: '6201234500031' },
  { sku: 'CET-10-T', name: 'Cetirizine 10mg Tablets', generic: 'Cetirizine', brand: 'Cetrizet', type: 'tablet', category: 'Antihistamines & Allergy', manufacturer: 'Rift Valley Generics', supplier: 1, form: 'Tablet', strength: '10mg', unit: 'strip', pack: 10, cost: 400, price: 1000, reorder: 30, max: 200, packPrice: 9000, pop: 6, barcode: '6201234500048', scenario: 'expiring' },
  { sku: 'OME-20-C', name: 'Omeprazole 20mg Capsules', generic: 'Omeprazole', brand: 'Omez', type: 'capsule', category: 'Gastrointestinal', manufacturer: 'Indus Lifesciences', supplier: 0, form: 'Capsule', strength: '20mg', unit: 'strip', pack: 10, cost: 900, price: 2000, min: 1800, reorder: 25, max: 150, pop: 5, barcode: '6201234500055', scenario: 'low' },
  { sku: 'ORS-SACH', name: 'ORS Oral Rehydration Salts', generic: 'Oral rehydration salts', brand: 'Rehydra', type: 'powder', category: 'Rehydration', manufacturer: 'Mwanza Pharma Labs', supplier: 2, form: 'Sachet', strength: '20.5g', unit: 'sachet', pack: 50, cost: 300, price: 600, reorder: 50, max: 300, pop: 7, barcode: '6201234500062' },
  { sku: 'VTC-1000-E', name: 'Vitamin C 1000mg Effervescent', generic: 'Ascorbic acid', brand: 'C-Fizz', type: 'supplement', category: 'Vitamins & Supplements', manufacturer: 'Nile Biotech', supplier: 3, form: 'Effervescent tablet', strength: '1000mg', unit: 'tube', pack: 1, cost: 3500, price: 6500, reorder: 15, max: 80, pop: 4, barcode: '6201234500079', scenario: 'low' },
  { sku: 'ANT-SEP-500', name: 'Antiseptic Liquid 500ml', generic: 'Chloroxylenol 4.8%', brand: 'Safeguard Antiseptic', type: 'personal_care', category: 'Antiseptics & First Aid', manufacturer: 'Coastal Care Products', supplier: 3, form: 'Solution', strength: '4.8% w/v', unit: 'bottle', pack: 12, cost: 6000, price: 9500, reorder: 10, max: 60, tax: 18, pop: 3, barcode: '6201234500086' },
  { sku: 'CGH-SYR-100', name: 'Cough Syrup 100ml', generic: 'Diphenhydramine + Ammonium chloride', brand: 'Kofgo', type: 'syrup', category: 'Cough, Cold & Flu', manufacturer: 'Kibo Pharmaceuticals', supplier: 2, form: 'Syrup', strength: '100ml', unit: 'bottle', pack: 24, cost: 2800, price: 5000, reorder: 20, max: 120, pop: 5, barcode: '6201234500093', scenario: 'expired' },
  { sku: 'ALU-20-120', name: 'Artemether/Lumefantrine 20/120mg', generic: 'Artemether + Lumefantrine', brand: 'Malafin', type: 'tablet', category: 'Antimalarials', manufacturer: 'Indus Lifesciences', supplier: 0, form: 'Tablet', strength: '20mg/120mg', unit: 'pack', pack: 1, cost: 2200, price: 4500, min: 4000, reorder: 25, max: 150, rx: true, pop: 4, storage: 'Store below 30°C. Protect from light.' },
  { sku: 'MET-500-T', name: 'Metformin 500mg Tablets', generic: 'Metformin', brand: 'Glucomet', type: 'tablet', category: 'Cardiovascular & Diabetes', manufacturer: 'Rift Valley Generics', supplier: 0, form: 'Film-coated tablet', strength: '500mg', unit: 'strip', pack: 10, cost: 600, price: 1300, reorder: 30, max: 200, rx: true, pop: 3 },
  { sku: 'AML-5-T', name: 'Amlodipine 5mg Tablets', generic: 'Amlodipine', brand: 'Amlopres', type: 'tablet', category: 'Cardiovascular & Diabetes', manufacturer: 'Indus Lifesciences', supplier: 0, form: 'Tablet', strength: '5mg', unit: 'strip', pack: 10, cost: 700, price: 1500, reorder: 25, max: 150, rx: true, pop: 3 },
  { sku: 'CIP-500-T', name: 'Ciprofloxacin 500mg Tablets', generic: 'Ciprofloxacin', brand: 'Ciprolet', type: 'tablet', category: 'Antibiotics', manufacturer: 'Indus Lifesciences', supplier: 2, form: 'Film-coated tablet', strength: '500mg', unit: 'strip', pack: 10, cost: 1100, price: 2400, reorder: 20, max: 120, rx: true, pop: 2 },
  { sku: 'MTZ-400-T', name: 'Metronidazole 400mg Tablets', generic: 'Metronidazole', brand: 'Flagyz', type: 'tablet', category: 'Antibiotics', manufacturer: 'Mwanza Pharma Labs', supplier: 2, form: 'Tablet', strength: '400mg', unit: 'strip', pack: 10, cost: 450, price: 1000, reorder: 25, max: 150, rx: true, pop: 3 },
  { sku: 'DIC-50-T', name: 'Diclofenac 50mg Tablets', generic: 'Diclofenac sodium', brand: 'Dicloz', type: 'tablet', category: 'Analgesics & Antipyretics', manufacturer: 'Zanzi Healthcare', supplier: 1, form: 'Enteric-coated tablet', strength: '50mg', unit: 'strip', pack: 10, cost: 400, price: 900, reorder: 30, max: 200, packPrice: 8000, pop: 5 },
  { sku: 'PAR-SYR-60', name: 'Paracetamol Paediatric Syrup 60ml', generic: 'Paracetamol', brand: 'Kibodol Junior', type: 'syrup', category: 'Analgesics & Antipyretics', manufacturer: 'Kibo Pharmaceuticals', supplier: 0, form: 'Syrup', strength: '120mg/5ml', unit: 'bottle', pack: 24, cost: 1500, price: 3000, reorder: 20, max: 120, pop: 5 },
  { sku: 'ZNC-20-T', name: 'Zinc Sulphate 20mg Dispersible', generic: 'Zinc sulphate', brand: 'Zinkid', type: 'tablet', category: 'Rehydration', manufacturer: 'Mwanza Pharma Labs', supplier: 2, form: 'Tablet', strength: '20mg', unit: 'strip', pack: 10, cost: 500, price: 1000, reorder: 20, max: 120, pop: 3 },
  { sku: 'LOR-10-T', name: 'Loratadine 10mg Tablets', generic: 'Loratadine', brand: 'Lorid', type: 'tablet', category: 'Antihistamines & Allergy', manufacturer: 'Rift Valley Generics', supplier: 1, form: 'Tablet', strength: '10mg', unit: 'strip', pack: 10, cost: 450, price: 1200, reorder: 20, max: 120, pop: 2 },
  { sku: 'ANTC-SUS-200', name: 'Antacid Suspension 200ml', generic: 'Magnesium + Aluminium hydroxide', brand: 'Gelusan', type: 'syrup', category: 'Gastrointestinal', manufacturer: 'Zanzi Healthcare', supplier: 3, form: 'Suspension', strength: '200ml', unit: 'bottle', pack: 24, cost: 2500, price: 4500, reorder: 15, max: 80, pop: 3 },
  { sku: 'MVT-30-T', name: 'Multivitamin Tablets (30)', generic: 'Multivitamins & minerals', brand: 'VitaDay', type: 'supplement', category: 'Vitamins & Supplements', manufacturer: 'Nile Biotech', supplier: 3, form: 'Tablet', strength: null, unit: 'bottle', pack: 1, cost: 5500, price: 9000, reorder: 10, max: 60, pop: 2 },
  { sku: 'FOL-5-T', name: 'Folic Acid 5mg Tablets', generic: 'Folic acid', brand: null, type: 'tablet', category: 'Vitamins & Supplements', manufacturer: 'Mwanza Pharma Labs', supplier: 2, form: 'Tablet', strength: '5mg', unit: 'strip', pack: 10, cost: 200, price: 500, reorder: 20, max: 150, pop: 2 },
  { sku: 'HYD-1-CR', name: 'Hydrocortisone 1% Cream 15g', generic: 'Hydrocortisone', brand: 'Cortiderm', type: 'cream', category: 'Dermatology', manufacturer: 'Zanzi Healthcare', supplier: 1, form: 'Cream', strength: '1%', unit: 'tube', pack: 12, cost: 1800, price: 3500, reorder: 10, max: 60, pop: 2 },
  { sku: 'CLT-1-CR', name: 'Clotrimazole 1% Cream 20g', generic: 'Clotrimazole', brand: 'Canezol', type: 'cream', category: 'Dermatology', manufacturer: 'Rift Valley Generics', supplier: 1, form: 'Cream', strength: '1%', unit: 'tube', pack: 12, cost: 1500, price: 3000, reorder: 10, max: 60, pop: 2, scenario: 'out' },
  { sku: 'TET-1-OIN', name: 'Tetracycline Eye Ointment 1%', generic: 'Tetracycline', brand: null, type: 'ointment', category: 'Eye & Ear Care', manufacturer: 'Mwanza Pharma Labs', supplier: 2, form: 'Ointment', strength: '1%', unit: 'tube', pack: 12, cost: 700, price: 1500, reorder: 10, max: 60, pop: 1 },
  { sku: 'CHL-EYE-10', name: 'Chloramphenicol Eye Drops 0.5%', generic: 'Chloramphenicol', brand: 'Optichlor', type: 'drops', category: 'Eye & Ear Care', manufacturer: 'Indus Lifesciences', supplier: 0, form: 'Eye drops', strength: '0.5%', unit: 'bottle', pack: 12, cost: 1300, price: 2800, reorder: 10, max: 50, rx: true, pop: 1, storage: 'Refrigerate 2–8°C. Discard 4 weeks after opening.' },
  { sku: 'SAL-INH-100', name: 'Salbutamol Inhaler 100mcg', generic: 'Salbutamol', brand: 'Asthalin-K', type: 'inhaler', category: 'Cough, Cold & Flu', manufacturer: 'Indus Lifesciences', supplier: 3, form: 'Inhaler', strength: '100mcg/dose', unit: 'piece', pack: 1, cost: 6500, price: 11000, reorder: 8, max: 40, rx: true, pop: 1 },
  { sku: 'CET-SYR-60', name: 'Cetirizine Syrup 60ml', generic: 'Cetirizine', brand: 'Cetrizet Junior', type: 'syrup', category: 'Antihistamines & Allergy', manufacturer: 'Rift Valley Generics', supplier: 1, form: 'Syrup', strength: '5mg/5ml', unit: 'bottle', pack: 24, cost: 1400, price: 3000, reorder: 10, max: 60, pop: 2 },
  { sku: 'IRN-FOL-T', name: 'Ferrous + Folic Acid Tablets', generic: 'Ferrous sulphate + Folic acid', brand: 'Ferrofol', type: 'tablet', category: 'Vitamins & Supplements', manufacturer: 'Kibo Pharmaceuticals', supplier: 0, form: 'Tablet', strength: '200mg/0.4mg', unit: 'strip', pack: 10, cost: 300, price: 700, reorder: 20, max: 150, pop: 2 },
  { sku: 'GLI-5-T', name: 'Glibenclamide 5mg Tablets', generic: 'Glibenclamide', brand: null, type: 'tablet', category: 'Cardiovascular & Diabetes', manufacturer: 'Mwanza Pharma Labs', supplier: 2, form: 'Tablet', strength: '5mg', unit: 'strip', pack: 10, cost: 350, price: 900, reorder: 15, max: 100, rx: true, pop: 1 },
  { sku: 'INJ-CEF-1G', name: 'Ceftriaxone 1g Injection', generic: 'Ceftriaxone', brand: 'Cefrin', type: 'injection', category: 'Antibiotics', manufacturer: 'Indus Lifesciences', supplier: 0, form: 'Injection', strength: '1g', unit: 'vial', pack: 10, cost: 1800, price: 3500, reorder: 10, max: 60, rx: true, pop: 1, storage: 'Store below 25°C. Reconstitute immediately before use.' },
  { sku: 'PLS-ASST', name: 'Adhesive Plasters (Assorted 20)', generic: null, brand: 'FirstStrip', type: 'medical_device', category: 'Antiseptics & First Aid', manufacturer: 'Lakeview Medical Devices', supplier: 3, form: null, strength: null, unit: 'box', pack: 1, cost: 1200, price: 2500, reorder: 15, max: 80, tax: 18, tracked: false, pop: 3 },
  { sku: 'BND-CRP-7', name: 'Crepe Bandage 7.5cm', generic: null, brand: null, type: 'medical_device', category: 'Antiseptics & First Aid', manufacturer: 'Lakeview Medical Devices', supplier: 3, form: null, strength: null, unit: 'piece', pack: 12, cost: 900, price: 2000, reorder: 10, max: 60, tax: 18, tracked: false, pop: 2 },
  { sku: 'THM-DIG', name: 'Digital Thermometer', generic: null, brand: 'ThermoQuick', type: 'medical_device', category: 'Medical Devices', manufacturer: 'Lakeview Medical Devices', supplier: 3, form: 'Device', strength: null, unit: 'piece', pack: 1, cost: 4500, price: 8000, reorder: 5, max: 30, tax: 18, tracked: false, pop: 1 },
  { sku: 'BPM-ARM', name: 'Automatic BP Monitor (Upper Arm)', generic: null, brand: 'CardioCheck', type: 'medical_device', category: 'Medical Devices', manufacturer: 'Lakeview Medical Devices', supplier: 3, form: 'Device', strength: null, unit: 'piece', pack: 1, cost: 48000, price: 75000, reorder: 2, max: 10, tax: 18, tracked: false, pop: 0.3 },
  { sku: 'GLU-STR-50', name: 'Glucose Test Strips (50)', generic: null, brand: 'GlucoSure', type: 'medical_device', category: 'Medical Devices', manufacturer: 'Lakeview Medical Devices', supplier: 3, form: 'Device', strength: null, unit: 'box', pack: 1, cost: 18000, price: 28000, reorder: 5, max: 30, tax: 18, pop: 0.6 },
  { sku: 'HND-SAN-250', name: 'Hand Sanitizer 250ml', generic: 'Ethanol 70%', brand: 'CleanHands', type: 'personal_care', category: 'Personal Care', manufacturer: 'Coastal Care Products', supplier: 3, form: 'Gel', strength: '70%', unit: 'bottle', pack: 24, cost: 2200, price: 4000, reorder: 15, max: 80, tax: 18, pop: 2 },
  { sku: 'PET-JEL-100', name: 'Petroleum Jelly 100ml', generic: 'White soft paraffin', brand: 'SoftSkin', type: 'personal_care', category: 'Personal Care', manufacturer: 'Coastal Care Products', supplier: 3, form: null, strength: null, unit: 'jar', pack: 24, cost: 1200, price: 2500, reorder: 15, max: 80, tax: 18, pop: 2 },
  { sku: 'CND-PK3', name: 'Condoms (Pack of 3)', generic: null, brand: 'Salama', type: 'personal_care', category: 'Personal Care', manufacturer: 'Coastal Care Products', supplier: 3, form: null, strength: null, unit: 'pack', pack: 48, cost: 500, price: 1000, reorder: 30, max: 200, tax: 18, pop: 3 },
  { sku: 'MBZ-500-T', name: 'Mebendazole 500mg Tablet', generic: 'Mebendazole', brand: 'Vermox-K', type: 'tablet', category: 'Gastrointestinal', manufacturer: 'Kibo Pharmaceuticals', supplier: 2, form: 'Chewable tablet', strength: '500mg', unit: 'tablet', pack: 50, cost: 300, price: 800, reorder: 30, max: 200, pop: 2 },
  { sku: 'LOP-2-C', name: 'Loperamide 2mg Capsules', generic: 'Loperamide', brand: 'Stopan', type: 'capsule', category: 'Gastrointestinal', manufacturer: 'Zanzi Healthcare', supplier: 1, form: 'Capsule', strength: '2mg', unit: 'strip', pack: 10, cost: 500, price: 1200, reorder: 15, max: 100, pop: 2 },
];

export const CUSTOMERS = [
  { fullName: 'Amina Hassan', phone: '+255712004511', customerType: 'regular', gender: 'female', dateOfBirth: '1986-04-12', address: 'Sinza Mori, Dar es Salaam', creditLimit: 150_000 },
  { fullName: 'John Mwangosi', phone: '+255754331209', customerType: 'regular', gender: 'male', dateOfBirth: '1972-11-03', address: 'Mwenge, Dar es Salaam', creditLimit: 200_000 },
  { fullName: 'Mariam Kassim', phone: '+255715778012', customerType: 'insurance', gender: 'female', insuranceProvider: 'NHIF', address: 'Kijitonyama', creditLimit: 300_000 },
  { fullName: 'Hamisi Omary', phone: '+255683221450', customerType: 'walk_in', gender: 'male' },
  { fullName: 'Esther Mollel', phone: '+255769554003', customerType: 'regular', gender: 'female', dateOfBirth: '1990-07-22', creditLimit: 100_000 },
  { fullName: 'Sinza Family Clinic', phone: '+255222771845', email: 'admin@sinzaclinic.co.tz', customerType: 'corporate', address: 'Shekilango Road, Sinza', creditLimit: 2_000_000 },
  { fullName: 'Rashid Mfinanga', phone: '+255714908336', customerType: 'regular', gender: 'male', dateOfBirth: '1965-02-18', creditLimit: 150_000 },
  { fullName: 'Zawadi Nyirenda', phone: '+255756120887', customerType: 'regular', gender: 'female' },
  { fullName: 'Godfrey Mbwambo', phone: '+255688410922', customerType: 'insurance', gender: 'male', insuranceProvider: 'Jubilee Health', creditLimit: 250_000 },
  { fullName: 'Fatma Salim', phone: '+255717300654', customerType: 'regular', gender: 'female', dateOfBirth: '1958-09-30', creditLimit: 100_000 },
  { fullName: 'Kelvin Shirima', phone: '+255765902341', customerType: 'walk_in', gender: 'male' },
  { fullName: 'Upendo Day Care Centre', phone: '+255222774410', customerType: 'corporate', creditLimit: 500_000 },
  { fullName: 'Mbezi Duka la Dawa Muhimu', phone: '+255713448902', email: 'orders@mbezidawa.co.tz', customerType: 'wholesale', address: 'Mbezi Beach, Dar es Salaam', creditLimit: 1_500_000 },
] as const;

export const STAFF = [
  { fullName: 'Joseph Mwakyusa', email: 'admin@upendopharmacy.co.tz', jobTitle: 'System administrator', role: 'super_admin', phone: '+255754100200' },
  { fullName: 'Grace Kimaro', email: 'grace@upendopharmacy.co.tz', jobTitle: 'Owner & Manager', role: 'manager', phone: '+255754100201' },
  { fullName: 'Halima Said', email: 'halima@upendopharmacy.co.tz', jobTitle: 'Pharmacist in charge', role: 'pharmacist', phone: '+255754100202' },
  { fullName: 'Baraka Mushi', email: 'baraka@upendopharmacy.co.tz', jobTitle: 'Pharmaceutical technologist', role: 'pharmacist', phone: '+255754100203' },
  { fullName: 'Rehema Juma', email: 'rehema@upendopharmacy.co.tz', jobTitle: 'Cashier', role: 'cashier', phone: '+255754100204' },
  { fullName: 'Emmanuel Lyimo', email: 'emmanuel@upendopharmacy.co.tz', jobTitle: 'Stores & inventory officer', role: 'inventory_officer', phone: '+255754100205' },
  { fullName: 'Fatuma Ally', email: 'fatuma@upendopharmacy.co.tz', jobTitle: 'Accountant', role: 'accountant', phone: '+255754100206' },
] as const;

export const PRESCRIBERS = [
  { name: 'Dr. Salma Rajab', facility: 'Mwananyamala Regional Referral Hospital', reg: 'MCT-11842' },
  { name: 'Dr. Felix Kimaro', facility: 'Sinza Family Clinic', reg: 'MCT-09311' },
  { name: 'Dr. Agnes Mushi', facility: 'Palestina Hospital, Sinza', reg: 'MCT-13027' },
  { name: 'Dr. Ibrahim Nasoro', facility: 'Kairuki Hospital', reg: 'MCT-07766' },
];
