import unittest
import pymupdf as fitz
from pdf_navigation import add_navigation,reader_bookmarks

class NavigationTests(unittest.TestCase):
    def test_authored_read_and_team_fallback_are_distinct(self):
        doc=fitz.open()
        for _ in range(5):doc.new_page(width=612,height=792)
        players=[dict(key='one',team='CGY'),dict(key='two',team='CGY')]
        records=[dict(type='ranking',page=3,keys=['one','two'],rowBounds=[[36,175,576,210],[36,210,576,245]]),dict(type='profile',page=4,key='one'),dict(type='team',page=5,team='CGY')]
        result=add_navigation(doc,records,players)
        self.assertEqual([r['destination'] for r in result['boardLinks']],[4,5,5,5])
        reopened=fitz.open(stream=doc.tobytes(),filetype='pdf')
        self.assertEqual(len(reopened[2].get_links()),6)
        self.assertEqual(result['contentsLinks'],4)
        self.assertTrue(all(l['page']<5 for p in reopened for l in p.get_links()))
        self.assertEqual(result['boardReturnLinks'],4)

    def test_alphabetical_index_keeps_same_named_players_and_exact_board_pages(self):
        players=[dict(key='d',name='Elias Pettersson',team='VAN',overallRank=250),dict(key='c',name='Elias Pettersson',team='VAN',overallRank=50),dict(key='a',name='Sebastian Aho',team='CAR',overallRank=10)]
        records=[dict(type='ranking',page=9,keys=['c','a']),dict(type='ranking',page=14,keys=['d']),dict(type='team',page=24,team='VAN')]
        toc=reader_bookmarks([('All 32 team playbooks',24)],records,players)
        self.assertEqual(toc[-3:],[ [2,'Sebastian Aho / CAR / #10',9],[2,'Elias Pettersson / VAN / #50',9],[2,'Elias Pettersson / VAN / #250',14]])
        self.assertIn([2,'VAN',24],toc)

    def test_missing_team_is_not_silently_linked_elsewhere(self):
        doc=fitz.open();doc.new_page()
        with self.assertRaises(KeyError):
            add_navigation(doc,[dict(type='ranking',page=1,keys=['one'],rowBounds=[[36,175,576,210]])],[dict(key='one',team='CGY')])
