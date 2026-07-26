export interface PoliticianSeed {
    name: string;
    slug: string;
    party: string;
    state?: string;
    portfolio: string;
    portfolioTopics: string[];
    xHandle: string;
}

function handleUrl(handle: string): string {
    return `https://x.com/${handle.replace(/^@/, '')}`;
}

/**
 * Union Cabinet Ministers only (incl. PM) — Modi 3.0.
 * Opposition / CMs / MoS are intentionally excluded for now.
 * Source shape: Cabinet Secretariat / Third Modi ministry (cabinet rank).
 */
export const POLITICIAN_SEEDS: PoliticianSeed[] = [
    {
        name: 'Narendra Modi',
        slug: 'narendra-modi',
        party: 'BJP',
        state: 'India',
        portfolio: 'Personnel / Atomic Energy / Space',
        portfolioTopics: [
            'personnel', 'public grievances', 'pensions', 'administrative reforms',
            'department of personnel', 'dopt', 'lokpal', 'cvc',
            'atomic energy', 'nuclear energy', 'nuclear power', 'dae',
            'space programme', 'space program', 'space mission', 'space research',
            'indian space', 'isro', 'department of space', 'satellite launch',
            'satellite', 'gslv', 'pslv',
            'परमाणु', 'अंतरिक्ष', 'कार्मिक', 'पेंशन',
        ],
        xHandle: 'narendramodi',
    },
    {
        name: 'Rajnath Singh',
        slug: 'rajnath-singh',
        party: 'BJP',
        portfolio: 'Defence',
        portfolioTopics: [
            'defence', 'defense', 'armed forces', 'army', 'navy', 'air force',
            'military', 'indigenous', 'weapon', 'border security', 'raksha',
        ],
        xHandle: 'rajnathsingh',
    },
    {
        name: 'Amit Shah',
        slug: 'amit-shah',
        party: 'BJP',
        portfolio: 'Home Affairs / Cooperation',
        portfolioTopics: [
            'home affairs', 'internal security', 'police', 'border', 'naxal',
            'terrorism', 'citizenship', 'law and order', 'suraksha', 'gribh',
            'cooperation', 'cooperative', 'sahkar', 'सहकारिता',
        ],
        xHandle: 'AmitShah',
    },
    {
        name: 'Nitin Gadkari',
        slug: 'nitin-gadkari',
        party: 'BJP',
        portfolio: 'Road Transport & Highways',
        portfolioTopics: [
            'highway', 'road', 'transport', 'infrastructure', 'expressway',
            'bridge', 'nhai', 'ev', 'biofuel', 'sarak', 'parivahan',
        ],
        xHandle: 'nitin_gadkari',
    },
    {
        name: 'J. P. Nadda',
        slug: 'jp-nadda',
        party: 'BJP',
        portfolio: 'Health & Family Welfare / Chemicals & Fertilizers',
        portfolioTopics: [
            'health', 'hospital', 'ayushman', 'vaccine', 'medical', 'pharma',
            'public health', 'family welfare', 'chemicals', 'fertilizer',
            'swasthya', 'chikitsa',
        ],
        xHandle: 'JPNadda',
    },
    {
        name: 'Shivraj Singh Chouhan',
        slug: 'shivraj-singh-chouhan',
        party: 'BJP',
        portfolio: 'Agriculture & Farmers Welfare / Rural Development',
        portfolioTopics: [
            'agriculture', 'farmer', 'farmers', 'rural', 'kisan', 'crop',
            'irrigation', 'msp', 'krishi', 'gramin',
        ],
        xHandle: 'ChouhanShivraj',
    },
    {
        name: 'Nirmala Sitharaman',
        slug: 'nirmala-sitharaman',
        party: 'BJP',
        portfolio: 'Finance / Corporate Affairs',
        portfolioTopics: [
            'finance', 'budget', 'tax', 'gst', 'economy', 'fiscal', 'inflation',
            'banking', 'investment', 'revenue', 'corporate affairs',
            'vitta', 'arthvyavastha',
        ],
        xHandle: 'nsitharaman',
    },
    {
        name: 'S. Jaishankar',
        slug: 's-jaishankar',
        party: 'BJP',
        portfolio: 'External Affairs',
        portfolioTopics: [
            'external affairs', 'foreign policy', 'diplomacy', 'bilateral',
            'united nations', 'g20', 'embassy', 'visa', 'diaspora', 'videsh',
        ],
        xHandle: 'DrSJaishankar',
    },
    {
        name: 'Manohar Lal Khattar',
        slug: 'manohar-lal-khattar',
        party: 'BJP',
        portfolio: 'Power / Housing & Urban Affairs',
        portfolioTopics: [
            'power', 'electricity', 'housing', 'urban', 'pmay', 'renewable power',
            'grid', 'awas', 'vidyut',
        ],
        xHandle: 'mlkhattar',
    },
    {
        name: 'H. D. Kumaraswamy',
        slug: 'hd-kumaraswamy',
        party: 'JD(S)',
        portfolio: 'Heavy Industries / Steel',
        portfolioTopics: [
            'heavy industries', 'steel', 'manufacturing', 'industrial',
            'psu', 'factory',
        ],
        xHandle: 'HD_Kumaraswamy',
    },
    {
        name: 'Piyush Goyal',
        slug: 'piyush-goyal',
        party: 'BJP',
        portfolio: 'Commerce & Industry',
        portfolioTopics: [
            'commerce', 'industry', 'export', 'trade', 'manufacturing',
            'startup', 'fdi', 'msme', 'make in india', 'udyog',
        ],
        xHandle: 'PiyushGoyal',
    },
    {
        name: 'Pralhad Joshi',
        slug: 'pralhad-joshi',
        party: 'BJP',
        portfolio: 'Education / Consumer Affairs / Food & Public Distribution / New & Renewable Energy',
        portfolioTopics: [
            'education', 'school', 'university', 'nep', 'student', 'teacher',
            'consumer affairs', 'food distribution', 'pds', 'ration',
            'renewable energy', 'solar', 'green hydrogen', 'shiksha',
        ],
        xHandle: 'JoshiPralhad',
    },
    {
        name: 'Jitan Ram Manjhi',
        slug: 'jitan-ram-manjhi',
        party: 'HAM(S)',
        portfolio: 'Micro, Small & Medium Enterprises',
        portfolioTopics: [
            'msme', 'small enterprise', 'medium enterprise', 'entrepreneur',
            'udyam', 'cottage industry',
        ],
        xHandle: 'jitanrammanjhi',
    },
    {
        name: 'Lalan Singh',
        slug: 'lalan-singh',
        party: 'JD(U)',
        portfolio: 'Panchayati Raj / Fisheries / Animal Husbandry & Dairying',
        portfolioTopics: [
            'panchayati raj', 'panchayat', 'fisheries', 'animal husbandry',
            'dairy', 'livestock', 'fishermen',
        ],
        xHandle: 'LalanSingh_',
    },
    {
        name: 'Sarbananda Sonowal',
        slug: 'sarbananda-sonowal',
        party: 'BJP',
        portfolio: 'Ports / Shipping / Waterways',
        portfolioTopics: [
            'port', 'shipping', 'maritime', 'waterways', 'coastal', 'harbour',
        ],
        xHandle: 'sonowal_s',
    },
    {
        name: 'Virendra Kumar',
        slug: 'virendra-kumar',
        party: 'BJP',
        portfolio: 'Social Justice & Empowerment',
        portfolioTopics: [
            'social justice', 'empowerment', 'sc', 'st', 'obc', 'disability',
            'welfare', 'samajik nyay',
        ],
        xHandle: 'DrVirendraKumar',
    },
    {
        name: 'Kinjarapu Ram Mohan Naidu',
        slug: 'kinjarapu-ram-mohan-naidu',
        party: 'TDP',
        portfolio: 'Civil Aviation',
        portfolioTopics: [
            'aviation', 'airport', 'airline', 'flight', 'civil aviation', 'udaan',
        ],
        xHandle: 'RammohanNaidu',
    },
    {
        name: 'Jual Oram',
        slug: 'jual-oram',
        party: 'BJP',
        portfolio: 'Tribal Affairs',
        portfolioTopics: [
            'tribal', 'adivasi', 'vanvasi', 'forest rights', 'tribal welfare',
        ],
        xHandle: 'JualOram',
    },
    {
        name: 'Giriraj Singh',
        slug: 'giriraj-singh',
        party: 'BJP',
        portfolio: 'Textiles',
        portfolioTopics: [
            'textile', 'textiles', 'garment', 'handloom', 'cotton', 'apparel',
        ],
        xHandle: 'GirirajSinghBJP',
    },
    {
        name: 'Ashwini Vaishnaw',
        slug: 'ashwini-vaishnaw',
        party: 'BJP',
        portfolio: 'Railways / Information & Broadcasting / Electronics & IT',
        portfolioTopics: [
            'railway', 'rail', 'vande bharat', 'station', 'it', 'telecom',
            '5g', 'digital india', 'semiconductor', 'electronics',
            'information technology', 'broadcasting', 'media',
        ],
        xHandle: 'AshwiniVaishnaw',
    },
    {
        name: 'Jyotiraditya Scindia',
        slug: 'jyotiraditya-scindia',
        party: 'BJP',
        portfolio: 'Communications / Development of North Eastern Region',
        portfolioTopics: [
            'communications', 'telecom', 'broadband', 'postal', 'bharatnet',
            'north east', 'northeast', 'doner', 'sanchar',
        ],
        xHandle: 'JM_Scindia',
    },
    {
        name: 'Bhupender Yadav',
        slug: 'bhupender-yadav',
        party: 'BJP',
        portfolio: 'Environment / Forest / Climate Change',
        portfolioTopics: [
            'environment', 'forest', 'climate', 'pollution', 'wildlife',
            'renewable', 'green', 'conservation', 'paryavaran',
        ],
        xHandle: 'byadavbjp',
    },
    {
        name: 'Gajendra Singh Shekhawat',
        slug: 'gajendra-singh-shekhawat',
        party: 'BJP',
        portfolio: 'Culture / Tourism',
        portfolioTopics: [
            'culture', 'tourism', 'heritage', 'monument', 'museum',
            'tourist', 'sanskriti', 'paryatan',
        ],
        xHandle: 'gssjodhpur',
    },
    {
        name: 'Annpurna Devi',
        slug: 'annpurna-devi',
        party: 'BJP',
        portfolio: 'Women & Child Development',
        portfolioTopics: [
            'women', 'child', 'nutrition', 'beti', 'empowerment',
            'welfare', 'mahila', 'bal',
        ],
        xHandle: 'Annapurna_Devi',
    },
    {
        name: 'Kiren Rijiju',
        slug: 'kiren-rijiju',
        party: 'BJP',
        portfolio: 'Parliamentary Affairs / Minority Affairs',
        portfolioTopics: [
            'parliament', 'minority', 'wajf', 'haj', 'legislative',
            'parliamentary affairs',
        ],
        xHandle: 'KirenRijiju',
    },
    {
        name: 'Hardeep Singh Puri',
        slug: 'hardeep-singh-puri',
        party: 'BJP',
        portfolio: 'Petroleum & Natural Gas',
        portfolioTopics: [
            'petroleum', 'oil', 'gas', 'fuel', 'energy', 'lpg', 'cng',
            'natural gas',
        ],
        xHandle: 'HardeepSPuri',
    },
    {
        name: 'Mansukh Mandaviya',
        slug: 'mansukh-mandaviya',
        party: 'BJP',
        portfolio: 'Labour & Employment / Youth Affairs & Sports',
        portfolioTopics: [
            'labour', 'labor', 'employment', 'jobs', 'worker', 'epfo',
            'youth', 'sports', 'olympics', 'rojgar', 'shram', 'khel',
        ],
        xHandle: 'mansukhmandviya',
    },
    {
        name: 'G. Kishan Reddy',
        slug: 'g-kishan-reddy',
        party: 'BJP',
        portfolio: 'Coal / Mines',
        portfolioTopics: [
            'coal', 'mines', 'mining', 'mineral', 'coal india', 'khadaan',
        ],
        xHandle: 'KishanReddyBJP',
    },
    {
        name: 'Chirag Paswan',
        slug: 'chirag-paswan',
        party: 'LJP(RV)',
        portfolio: 'Food Processing Industries',
        portfolioTopics: [
            'food processing', 'food industry', 'agro processing',
            'fpi', 'cold chain',
        ],
        xHandle: 'ChiragPaswan',
    },
    {
        name: 'C. R. Patil',
        slug: 'cr-patil',
        party: 'BJP',
        portfolio: 'Jal Shakti',
        portfolioTopics: [
            'jal shakti', 'water', 'irrigation', 'drinking water',
            'river', 'sanitation', 'swachh', 'jal',
        ],
        xHandle: 'CRPaatil',
    },
];

/** Cabinet-only active set size (PM + Cabinet Ministers). */
export const CABINET_MINISTER_COUNT = POLITICIAN_SEEDS.length;

export function toPoliticianDocument(seed: PoliticianSeed) {
    const xHandle = seed.xHandle.replace(/^@/, '');
    return {
        name: seed.name,
        slug: seed.slug,
        party: seed.party,
        state: seed.state,
        portfolio: seed.portfolio,
        portfolioTopics: seed.portfolioTopics.map((t) => t.toLowerCase()),
        xHandle,
        xProfileUrl: handleUrl(xHandle),
        isActive: true,
        lastScrapeStatus: 'never' as const,
        stats: {
            netScore: 0,
            onPortfolioPct: 0,
            postCount: 0,
            scoredPostCount: 0,
            onPortfolioCount: 0,
            relatedCount: 0,
            offTopicCount: 0,
            attackCount: 0,
            personalCount: 0,
            unknownCount: 0,
        },
    };
}
