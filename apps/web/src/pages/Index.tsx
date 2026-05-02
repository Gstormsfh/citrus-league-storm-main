import { logger } from '@/utils/logger';
import { Homepage } from '@/components/citrus2';

/**
 * Production homepage. Renders the Citrus 2.0 Homepage composition (dark
 * forest, hockey-first, Citrus Squad mascots). The legacy pastel homepage
 * components live unchanged in `apps/web/src/components/` until every page
 * has migrated to citrus2.
 */
const Index = () => {
  try {
    return <Homepage />;
  } catch (error) {
    logger.error('❌ Error in Index component:', error);
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h1>Error loading page</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }
};

export default Index;
