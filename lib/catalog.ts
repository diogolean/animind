import type { Attribution } from "./contract";

export interface Portrait {
  id: string;
  name: string;
  years: string;
  file: string;
  attribution: Attribution;
  jaw: { x: number; y: number; w: number; h: number };
}

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

/** Public-domain portraits only. No living famous people. */
export const PORTRAITS: Portrait[] = [
  {
    id: "lincoln",
    name: "Abraham Lincoln",
    years: "1809–1865",
    file: "Abraham_Lincoln_O-77_matte_collodion_print.jpg",
    attribution: { title: "Abraham Lincoln, O-77 (1863)", author: "Alexander Gardner", license: "Domínio público", sourceUrl: commons("Abraham_Lincoln_O-77_matte_collodion_print.jpg") },
    jaw: { x: 0.33, y: 0.5, w: 0.34, h: 0.17 },
  },
  {
    id: "monalisa",
    name: "Mona Lisa",
    years: "c. 1503",
    file: "Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg",
    attribution: { title: "Mona Lisa", author: "Leonardo da Vinci", license: "Domínio público", sourceUrl: commons("Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg") },
    jaw: { x: 0.4, y: 0.3, w: 0.2, h: 0.09 },
  },
  {
    id: "darwin",
    name: "Charles Darwin",
    years: "1809–1882",
    file: "Charles_Darwin_01.jpg",
    attribution: { title: "Charles Darwin", author: "Maull & Polyblank (c. 1855)", license: "Domínio público", sourceUrl: commons("Charles_Darwin_01.jpg") },
    jaw: { x: 0.36, y: 0.47, w: 0.3, h: 0.15 },
  },
  {
    id: "shakespeare",
    name: "William Shakespeare",
    years: "1564–1616",
    file: "Shakespeare.jpg",
    attribution: { title: "Chandos portrait", author: "Atribuído a John Taylor", license: "Domínio público", sourceUrl: commons("Shakespeare.jpg") },
    jaw: { x: 0.38, y: 0.46, w: 0.24, h: 0.13 },
  },
  {
    id: "newton",
    name: "Isaac Newton",
    years: "1643–1727",
    file: "GodfreyKneller-IsaacNewton-1689.jpg",
    attribution: { title: "Isaac Newton (1689)", author: "Godfrey Kneller", license: "Domínio público", sourceUrl: commons("GodfreyKneller-IsaacNewton-1689.jpg") },
    jaw: { x: 0.4, y: 0.4, w: 0.22, h: 0.1 },
  },
  {
    id: "machado",
    name: "Machado de Assis",
    years: "1839–1908",
    file: "Machado_de_Assis_aos_57_anos.jpg",
    attribution: { title: "Machado de Assis aos 57 anos (1896)", author: "Autor desconhecido", license: "Domínio público", sourceUrl: commons("Machado_de_Assis_aos_57_anos.jpg") },
    jaw: { x: 0.37, y: 0.5, w: 0.28, h: 0.14 },
  },
];

export const portraitById = (id: string) => PORTRAITS.find((p) => p.id === id);
export const portraitImageUrl = (id: string) => `/api/portraits/${id}`;
export const commonsFileUrl = (file: string, width = 640) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
