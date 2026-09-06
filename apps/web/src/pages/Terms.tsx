import html from '../../public/terms-of-service.html?raw';
import { LegalDocument } from '@/components/LegalDocument';

export default function Terms() {
  return <LegalDocument html={html} />;
}
