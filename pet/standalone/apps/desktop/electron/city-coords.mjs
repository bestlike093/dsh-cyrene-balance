/**
 * 城市坐标解析：名称归一化 + 坐标查表。
 *
 * 设计约束：解析失败一律返回 null，由调用方决定是否回落，
 * 本模块绝不擅自替用户选一座城——静默降级是最难排查的那种错。
 */

/**
 * 全国地级行政区坐标表（含省直辖县级市），共 342 个。
 *
 * 数据来源：open-meteo geocoding（底层 GeoNames），2026-11-09 批量抓取。
 * 消歧规则：限 country_code=CN → admin1 匹配所属省份 → population 最大的一条。
 * 该规则在同音城市上验证有效（宜春/伊春、泰州/台州、苏州/宿州、福州/抚州、玉林/榆林全部正确区分）。
 * 13 项经邻近锚点交叉校验后人工修正，见行内「人工修正」标注。
 *
 * 为什么不实时调 geocoding：GeoNames 的中文 alternatenames 覆盖极差——
 * 中文查「厦门」0 命中，查「青岛」首位错到辽宁；拼音查虽准，但天气只是可选增强项，
 * 不值得为它再加一个网络失败点。故一次抓准、离线内置。
 */
export const CITY_COORDS = {
  // 北京
  北京: { latitude: 39.9075, longitude: 116.3972 }, // Beijing/Beijing Municipality pop=18960744
  // 天津
  天津: { latitude: 39.1422, longitude: 117.1767 }, // Tianjin/Tianjin Municipality pop=13866009
  // 上海
  上海: { latitude: 31.2222, longitude: 121.4581 }, // Shanghai/Shanghai Municipality pop=24874500
  // 重庆
  重庆: { latitude: 29.5603, longitude: 106.5577 }, // Chongqing/Chongqing Municipality pop=22000000
  // 河北
  石家庄: { latitude: 38.0414, longitude: 114.4786 }, // Shijiazhuang/Hebei pop=5758403
  唐山: { latitude: 39.6438, longitude: 118.1832 }, // Tangshan/Hebei pop=3372102
  秦皇岛: { latitude: 39.941, longitude: 119.5894 }, // Qinhuangdao/Hebei pop=759718
  邯郸: { latitude: 36.61, longitude: 114.4876 }, // Handan/Hebei pop=1358318
  邢台: { latitude: 37.0622, longitude: 114.4927 }, // Xingtai/Hebei pop=798770
  保定: { latitude: 38.8729, longitude: 115.4625 }, // Baoding/Hebei pop=2739887
  张家口: { latitude: 40.7834, longitude: 114.8714 }, // Zhangjiakou/Hebei pop=692602
  承德: { latitude: 40.9519, longitude: 117.9588 }, // Chengde/Hebei pop=920395
  沧州: { latitude: 38.3112, longitude: 116.8533 }, // Cangzhou/Hebei pop=527681
  廊坊: { latitude: 39.5208, longitude: 116.7147 }, // Langfang/Hebei pop=868066
  衡水: { latitude: 37.7391, longitude: 115.6835 }, // Hengshui/Hebei pop=522147
  // 山西
  太原: { latitude: 37.8694, longitude: 112.5603 }, // Taiyuan/Shanxi pop=5305061
  大同: { latitude: 40.0936, longitude: 113.2914 }, // Datong/Shanxi pop=3105591
  阳泉: { latitude: 37.8575, longitude: 113.5633 }, // Yangquan/Shanxi pop=731228
  长治: { latitude: 36.1839, longitude: 113.1053 }, // Changzhi/Shanxi pop=1214940
  晋城: { latitude: 35.5022, longitude: 112.8328 }, // Jincheng/Shanxi pop=476945
  朔州: { latitude: 39.3158, longitude: 112.4225 }, // Shuozhou/Shanxi pop=433700
  晋中: { latitude: 37.684, longitude: 112.7547 }, // Jinzhong/Shanxi pop=1226617
  运城: { latitude: 35.0231, longitude: 110.9928 }, // Yuncheng/Shanxi pop=680036
  忻州: { latitude: 38.4092, longitude: 112.7333 }, // Xinzhou/Shanxi pop=544683
  临汾: { latitude: 36.0889, longitude: 111.5189 }, // Linfen/Shanxi pop=959198
  吕梁: { latitude: 37.5192, longitude: 111.1444 }, // Lüliang/Shanxi pop=3346500
  // 内蒙古
  呼和浩特: { latitude: 40.8106, longitude: 111.6522 }, // Hohhot/Inner Mongolia pop=3446100
  包头: { latitude: 40.6516, longitude: 109.8439 }, // Baotou/Inner Mongolia pop=2761700
  乌海: { latitude: 39.6844, longitude: 106.8158 }, // Wuhai/Inner Mongolia pop=218427
  赤峰: { latitude: 42.2683, longitude: 118.9636 }, // Chifeng/Inner Mongolia pop=346654
  通辽: { latitude: 43.6125, longitude: 122.2653 }, // Tongliao/Inner Mongolia pop=261110
  鄂尔多斯: { latitude: 39.6086, longitude: 109.7816 }, // Ordos/Inner Mongolia pop=2153638
  呼伦贝尔: { latitude: 49.2, longitude: 119.7 }, // Hailar/Inner Mongolia pop=211066
  巴彦淖尔: { latitude: 40.7514, longitude: 107.4206 }, // 人工修正：Linhe(临河)/Inner Mongolia
  乌兰察布: { latitude: 40.993, longitude: 113.133 }, // Ulanqab/Inner Mongolia pop=550231
  兴安盟: { latitude: 46.0833, longitude: 122.0833 }, // Ulanhot/Inner Mongolia pop=265600
  锡林郭勒盟: { latitude: 43.9389, longitude: 116.0702 }, // Xilinhot/Inner Mongolia pop=349953
  阿拉善盟: { latitude: 38.8229, longitude: 105.6262 }, // 人工修正：Alxa Left Banner(巴彦浩特)，距镇中心 4km
  大兴安岭: { latitude: 50.4167, longitude: 124.1167 }, // 人工修正：Jiagedaqi pop=137105（地理属内蒙，行政属黑龙江，坐标正确）
  // 辽宁
  沈阳: { latitude: 41.7922, longitude: 123.4328 }, // Shenyang/Liaoning pop=9070093
  大连: { latitude: 38.9122, longitude: 121.6022 }, // Dalian/Liaoning pop=7450785
  鞍山: { latitude: 41.1236, longitude: 122.99 }, // Anshan/Liaoning pop=3325372
  抚顺: { latitude: 41.8867, longitude: 123.9436 }, // Fushun/Liaoning pop=1400646
  本溪: { latitude: 41.2886, longitude: 123.765 }, // Benxi/Liaoning pop=865215
  丹东: { latitude: 40.1292, longitude: 124.3947 }, // Dandong/Liaoning pop=815858
  锦州: { latitude: 41.1078, longitude: 121.1417 }, // Jinzhou/Liaoning pop=1524362
  营口: { latitude: 40.6647, longitude: 122.2318 }, // Newchwang/Liaoning pop=591159
  阜新: { latitude: 42.0156, longitude: 121.6589 }, // Fuxin/Liaoning pop=689050
  辽阳: { latitude: 41.2719, longitude: 123.1731 }, // Liaoyang/Liaoning pop=687890
  盘锦: { latitude: 41.121, longitude: 122.0739 }, // Panjin/Liaoning pop=1166481
  铁岭: { latitude: 42.2931, longitude: 123.8414 }, // Tieling/Liaoning pop=459985
  朝阳: { latitude: 41.5703, longitude: 120.4586 }, // Chaoyang/Liaoning pop=410005
  葫芦岛: { latitude: 40.7524, longitude: 120.8355 }, // Huludao/Liaoning pop=944495
  // 吉林
  长春: { latitude: 43.88, longitude: 125.3228 }, // Changchun/Jilin pop=5691024
  吉林: { latitude: 43.8465, longitude: 126.5608 }, // Jilin City/Jilin pop=1895865
  四平: { latitude: 43.1614, longitude: 124.3778 }, // Siping/Jilin pop=627957
  辽源: { latitude: 42.8854, longitude: 125.1367 }, // Liaoyuan/Jilin pop=465249
  通化: { latitude: 41.7197, longitude: 125.9264 }, // Tonghua/Jilin pop=510000
  白山: { latitude: 41.9385, longitude: 126.4197 }, // Baishan/Jilin pop=183880
  松原: { latitude: 45.129, longitude: 124.8277 }, // Songyuan/Jilin pop=113611
  白城: { latitude: 45.6175, longitude: 122.833 }, // Baicheng/Jilin pop=316970
  延边: { latitude: 42.8882, longitude: 129.5024 }, // Yanji/Jilin pop=326957
  // 黑龙江
  哈尔滨: { latitude: 45.75, longitude: 126.65 }, // Harbin/Heilongjiang pop=10009854
  齐齐哈尔: { latitude: 47.3392, longitude: 123.9615 }, // Qiqihar/Heilongjiang pop=882364
  鸡西: { latitude: 45.2932, longitude: 130.9622 }, // Jixi/Heilongjiang pop=403759
  鹤岗: { latitude: 47.3473, longitude: 130.2903 }, // Hegang/Heilongjiang pop=743307
  双鸭山: { latitude: 46.6769, longitude: 131.1327 }, // Shuangyashan/Heilongjiang pop=600000
  大庆: { latitude: 46.5833, longitude: 125 }, // Daqing/Heilongjiang pop=1604027
  伊春: { latitude: 47.7214, longitude: 128.8753 }, // Yichun/Heilongjiang pop=155762
  佳木斯: { latitude: 46.7971, longitude: 130.3112 }, // Jiamusi/Heilongjiang pop=549549
  七台河: { latitude: 45.768, longitude: 130.9953 }, // Qitaihe/Heilongjiang pop=345033
  牡丹江: { latitude: 44.548, longitude: 129.6259 }, // Mudanjiang/Heilongjiang pop=665915
  黑河: { latitude: 50.2441, longitude: 127.4902 }, // Heihe/Heilongjiang pop=223832
  绥化: { latitude: 46.6481, longitude: 126.9666 }, // Suihua/Heilongjiang pop=252245
  // 江苏
  南京: { latitude: 32.0617, longitude: 118.7778 }, // Nanjing/Jiangsu pop=9314685
  无锡: { latitude: 31.5689, longitude: 120.2886 }, // Wuxi/Jiangsu pop=4396835
  徐州: { latitude: 34.2044, longitude: 117.2839 }, // Xuzhou/Jiangsu pop=1253991
  常州: { latitude: 31.7736, longitude: 119.954 }, // Changzhou/Jiangsu pop=3290918
  苏州: { latitude: 31.3041, longitude: 120.5954 }, // Suzhou/Jiangsu pop=6715559
  南通: { latitude: 32.0303, longitude: 120.8747 }, // Nantong/Jiangsu pop=2273326
  连云港: { latitude: 34.5984, longitude: 119.2156 }, // Lianyungang/Jiangsu pop=2001009
  盐城: { latitude: 33.3575, longitude: 120.1573 }, // Yancheng/Jiangsu pop=1615717
  扬州: { latitude: 32.3972, longitude: 119.4358 }, // Yangzhou/Jiangsu pop=4559797
  镇江: { latitude: 32.2109, longitude: 119.4551 }, // Zhenjiang/Jiangsu pop=950516
  泰州: { latitude: 32.4907, longitude: 119.9081 }, // Taizhou/Jiangsu pop=1607108
  宿迁: { latitude: 33.9492, longitude: 118.2958 }, // Suqian/Jiangsu pop=1437685
  山南: { latitude: 29.2437, longitude: 91.7728 }, // 人工修正：Tsetang(泽当)/Tibet
  淮安: { latitude: 33.5886, longitude: 119.0192 }, // 人工补录：Huai'an/Jiangsu pop=4556230
  // 浙江
  杭州: { latitude: 30.2936, longitude: 120.1614 }, // Hangzhou/Zhejiang pop=11936010
  宁波: { latitude: 29.8782, longitude: 121.5494 }, // Ningbo/Zhejiang pop=3731203
  温州: { latitude: 27.9994, longitude: 120.6668 }, // Wenzhou/Zhejiang pop=2650000
  嘉兴: { latitude: 30.7522, longitude: 120.75 }, // Jiaxing/Zhejiang pop=1180000
  湖州: { latitude: 30.8703, longitude: 120.0933 }, // Huzhou/Zhejiang pop=1015937
  绍兴: { latitude: 30.0024, longitude: 120.5786 }, // Shaoxing/Zhejiang pop=2300000
  金华: { latitude: 29.1068, longitude: 119.6442 }, // Jinhua/Zhejiang pop=1463990
  衢州: { latitude: 28.9594, longitude: 118.8686 }, // Quzhou/Zhejiang pop=902767
  舟山: { latitude: 29.9887, longitude: 122.2049 }, // Zhoushan/Zhejiang pop=882932
  台州: { latitude: 28.6627, longitude: 121.4331 }, // Taizhou/Zhejiang pop=1485502
  丽水: { latitude: 28.4604, longitude: 119.9103 }, // Lishui/Zhejiang pop=451418
  // 安徽
  合肥: { latitude: 31.8639, longitude: 117.2808 }, // Hefei/Anhui pop=9465881
  芜湖: { latitude: 31.3526, longitude: 118.4295 }, // Wuhu/Anhui pop=1598165
  蚌埠: { latitude: 32.9408, longitude: 117.3608 }, // Bengbu/Anhui pop=972784
  淮南: { latitude: 32.6264, longitude: 116.9969 }, // Huainan/Anhui pop=3033528
  马鞍山: { latitude: 31.6858, longitude: 118.5101 }, // Ma’anshan/Anhui pop=741531
  淮北: { latitude: 33.9744, longitude: 116.7917 }, // Huaibei/Anhui pop=1113321
  铜陵: { latitude: 30.95, longitude: 117.7833 }, // Tongling/Anhui pop=402062
  安庆: { latitude: 30.5136, longitude: 117.0472 }, // Anking/Anhui pop=804493
  黄山: { latitude: 29.7114, longitude: 118.3125 }, // Huangshan City/Anhui pop=460786
  滁州: { latitude: 32.3219, longitude: 118.2978 }, // Chuzhou/Anhui pop=782671
  阜阳: { latitude: 32.9, longitude: 115.8167 }, // Fuyang/Anhui pop=1768947
  宿州: { latitude: 33.6361, longitude: 116.9789 }, // Suzhou/Anhui pop=1647642
  六安: { latitude: 31.7356, longitude: 116.5169 }, // Lu'an/Anhui pop=1644344
  亳州: { latitude: 33.8772, longitude: 115.7703 }, // Bozhou/Anhui pop=1409436
  池州: { latitude: 30.6613, longitude: 117.4778 }, // Chizhou/Anhui pop=615274
  宣城: { latitude: 30.9525, longitude: 118.7553 }, // Xuancheng/Anhui pop=774332
  海北: { latitude: 36.8751, longitude: 100.9609 }, // 人工修正：Xihai(西海镇)/Qinghai pop=13161
  // 福建
  福州: { latitude: 26.0614, longitude: 119.3061 }, // Fuzhou/Fujian pop=4094491
  厦门: { latitude: 24.4798, longitude: 118.0819 }, // Xiamen/Fujian pop=4617251
  莆田: { latitude: 25.4394, longitude: 119.0103 }, // Putian/Fujian pop=1539389
  三明: { latitude: 26.2486, longitude: 117.6186 }, // Sanming/Fujian pop=602166
  泉州: { latitude: 24.9139, longitude: 118.5858 }, // Quanzhou/Fujian pop=1469157
  漳州: { latitude: 24.5133, longitude: 117.6556 }, // Zhangzhou/Fujian pop=589831
  南平: { latitude: 26.645, longitude: 118.1736 }, // Nanping/Fujian pop=467875
  龙岩: { latitude: 25.0749, longitude: 117.0178 }, // Longyan/Fujian pop=1025087
  宁德: { latitude: 26.6617, longitude: 119.5228 }, // Ningde/Fujian pop=429260
  // 江西
  南昌: { latitude: 28.684, longitude: 115.8531 }, // Nanchang/Jiangxi pop=2357839
  景德镇: { latitude: 29.2947, longitude: 117.2079 }, // Jingdezhen/Jiangxi pop=473561
  萍乡: { latitude: 27.6167, longitude: 113.8535 }, // Pingxiang/Jiangxi pop=893550
  九江: { latitude: 29.7048, longitude: 116.0021 }, // Jiujiang/Jiangxi pop=1164268
  新余: { latitude: 27.8043, longitude: 114.9334 }, // Xinyu/Jiangxi pop=839488
  鹰潭: { latitude: 28.2333, longitude: 117 }, // Yingtan/Jiangxi pop=214229
  赣州: { latitude: 25.8466, longitude: 114.9326 }, // Ganzhou/Jiangxi pop=1977253
  吉安: { latitude: 27.1172, longitude: 114.9793 }, // Ji’an/Jiangxi pop=538699
  宜春: { latitude: 27.8333, longitude: 114.4 }, // Yichun/Jiangxi pop=1045952
  抚州: { latitude: 27.96, longitude: 116.3333 }, // Fuzhou/Jiangxi pop=1089888
  上饶: { latitude: 28.4518, longitude: 117.9429 }, // Shangrao/Jiangxi pop=1116486
  // 山东
  济南: { latitude: 36.6683, longitude: 116.9972 }, // Jinan/Shandong pop=8352574
  青岛: { latitude: 36.0649, longitude: 120.3804 }, // Qingdao/Shandong pop=7172451
  淄博: { latitude: 36.7906, longitude: 118.0633 }, // Zibo/Shandong pop=4704138
  枣庄: { latitude: 34.8647, longitude: 117.5542 }, // Zaozhuang/Shandong pop=3855601
  东营: { latitude: 37.4627, longitude: 118.4917 }, // Dongying/Shandong pop=998968
  烟台: { latitude: 37.4765, longitude: 121.4408 }, // Yantai/Shandong pop=7102100
  潍坊: { latitude: 36.71, longitude: 119.1019 }, // Weifang/Shandong pop=9386705
  济宁: { latitude: 35.405, longitude: 116.5814 }, // Jining/Shandong pop=1241012
  泰安: { latitude: 36.1853, longitude: 117.12 }, // Tai’an/Shandong pop=1735425
  威海: { latitude: 37.5091, longitude: 122.1136 }, // Weihai/Shandong pop=844310
  日照: { latitude: 35.4141, longitude: 119.5291 }, // Rizhao/Shandong pop=661943
  临沂: { latitude: 35.0631, longitude: 118.3428 }, // Linyi/Shandong pop=2743843
  德州: { latitude: 37.4466, longitude: 116.3671 }, // Dezhou/Shandong pop=679535
  聊城: { latitude: 36.4506, longitude: 116.0025 }, // Liaocheng/Shandong pop=1229768
  滨州: { latitude: 37.3667, longitude: 118.0167 }, // Binzhou/Shandong pop=682717
  菏泽: { latitude: 35.2393, longitude: 115.4736 }, // Heze/Shandong pop=1346717
  // 河南
  郑州: { latitude: 34.7578, longitude: 113.6486 }, // Zhengzhou/Henan pop=6650532
  开封: { latitude: 34.7986, longitude: 114.3074 }, // Kaifeng/Henan pop=1451741
  洛阳: { latitude: 34.6735, longitude: 112.4368 }, // Luoyang/Henan pop=1390581
  平顶山: { latitude: 33.7309, longitude: 113.3155 }, // Pingdingshan/Henan pop=979130
  安阳: { latitude: 36.096, longitude: 114.3828 }, // Anyang/Henan pop=1146839
  鹤壁: { latitude: 35.7323, longitude: 114.2862 }, // Hebi/Henan pop=634721
  新乡: { latitude: 35.1903, longitude: 113.8015 }, // Xinxiang/Henan pop=1047088
  焦作: { latitude: 35.2392, longitude: 113.2391 }, // Jiaozuo/Henan pop=865413
  濮阳: { latitude: 35.7564, longitude: 115.0436 }, // Puyang/Henan pop=655674
  许昌: { latitude: 34.0319, longitude: 113.863 }, // Xuchang/Henan pop=1265536
  漯河: { latitude: 33.5742, longitude: 114.0326 }, // Luohe/Henan pop=1294974
  三门峡: { latitude: 34.7808, longitude: 111.1929 }, // Sanmenxia/Henan pop=669307
  南阳: { latitude: 33.0052, longitude: 112.5466 }, // Nanyang/Henan pop=1811812
  商丘: { latitude: 34.4143, longitude: 115.6561 }, // Shangqiu/Henan pop=1859723
  信阳: { latitude: 32.1228, longitude: 114.0656 }, // Xinyang/Henan pop=1416800
  周口: { latitude: 33.6147, longitude: 114.6499 }, // Zhoukou/Henan pop=505171
  驻马店: { latitude: 32.9838, longitude: 114.0259 }, // Zhumadian/Henan pop=721670
  济源: { latitude: 35.0891, longitude: 112.5881 }, // Jiyuan/Henan pop=242143
  // 湖北
  武汉: { latitude: 30.5833, longitude: 114.2667 }, // Wuhan/Hubei pop=13739000
  黄石: { latitude: 30.2471, longitude: 115.0481 }, // Huangshi/Hubei pop=688090
  十堰: { latitude: 32.6475, longitude: 110.7781 }, // Shiyan/Hubei pop=3460000
  宜昌: { latitude: 30.7144, longitude: 111.2847 }, // Yichang/Hubei pop=1350150
  襄阳: { latitude: 32.0422, longitude: 112.1448 }, // Xiangyang/Hubei pop=1294733
  鄂州: { latitude: 30.3961, longitude: 114.8865 }, // Ezhou/Hubei pop=668727
  荆门: { latitude: 31.0336, longitude: 112.2047 }, // Jingmen/Hubei pop=632954
  孝感: { latitude: 30.9269, longitude: 113.9222 }, // Xiaogan/Hubei pop=908266
  荆州: { latitude: 30.3503, longitude: 112.1903 }, // Jingzhou/Hubei pop=1052282
  黄冈: { latitude: 30.4514, longitude: 114.8704 }, // Huanggang/Hubei pop=366769
  咸宁: { latitude: 29.8435, longitude: 114.322 }, // Xianning/Hubei pop=512517
  随州: { latitude: 31.7111, longitude: 113.3631 }, // Suizhou/Hubei pop=618582
  恩施: { latitude: 30.3, longitude: 109.4833 }, // Enshi/Hubei pop=279185
  仙桃: { latitude: 30.3624, longitude: 113.4536 }, // 省直辖县级市
  潜江: { latitude: 30.4212, longitude: 112.8993 }, // 省直辖县级市
  天门: { latitude: 30.6533, longitude: 113.1661 }, // 省直辖县级市
  神农架: { latitude: 31.7442, longitude: 110.6757 }, // 省直辖县级市
  // 湖南
  长沙: { latitude: 28.1987, longitude: 112.9709 }, // Changsha/Hunan pop=3093980
  株洲: { latitude: 27.8333, longitude: 113.15 }, // Zhuzhou/Hunan pop=1129687
  湘潭: { latitude: 27.85, longitude: 112.9 }, // Xiangtan/Hunan pop=959303
  衡阳: { latitude: 26.8895, longitude: 112.6189 }, // Hengyang/Hunan pop=1075516
  邵阳: { latitude: 27.2382, longitude: 111.4621 }, // Shaoyang/Hunan pop=753194
  岳阳: { latitude: 29.3745, longitude: 113.0948 }, // Yueyang/Hunan pop=991465
  常德: { latitude: 29.0321, longitude: 111.6984 }, // Changde/Hunan pop=1457419
  张家界: { latitude: 29.1294, longitude: 110.4783 }, // Zhangjiajie/Hunan pop=441804
  益阳: { latitude: 28.5539, longitude: 112.355 }, // 人工修正：人工标定：GeoNames 原值(26.39,112.38)偏南240km，经长沙(28.20,112.97)与常德(29.03,111.70)锚点校正
  郴州: { latitude: 25.8, longitude: 113.0333 }, // Chenzhou/Hunan pop=822534
  永州: { latitude: 26.4239, longitude: 111.6131 }, // Yongzhou/Hunan pop=1020715
  怀化: { latitude: 27.5634, longitude: 110.004 }, // Huaihua/Hunan pop=552622
  娄底: { latitude: 27.7344, longitude: 111.9944 }, // Loudi/Hunan pop=497171
  湘西: { latitude: 28.3193, longitude: 109.7335 }, // Jishou/Hunan pop=102332
  // 广东
  广州: { latitude: 23.1167, longitude: 113.25 }, // Guangzhou/Guangdong pop=18676605
  韶关: { latitude: 24.8, longitude: 113.5833 }, // Shaoguan/Guangdong pop=1028460
  深圳: { latitude: 22.5455, longitude: 114.0683 }, // Shenzhen/Guangdong pop=17494398
  珠海: { latitude: 22.2769, longitude: 113.5678 }, // Zhuhai/Guangdong pop=2207090
  汕头: { latitude: 23.3549, longitude: 116.6788 }, // Shantou/Guangdong pop=3838900
  佛山: { latitude: 23.0268, longitude: 113.1315 }, // Foshan/Guangdong pop=9042509
  江门: { latitude: 22.5833, longitude: 113.0833 }, // Jiangmen/Guangdong pop=1795459
  湛江: { latitude: 21.2339, longitude: 110.3875 }, // Zhanjiang/Guangdong pop=1400709
  茂名: { latitude: 21.6663, longitude: 110.9136 }, // Maoming/Guangdong pop=1307802
  肇庆: { latitude: 23.0489, longitude: 112.4609 }, // Zhaoqing/Guangdong pop=1553109
  惠州: { latitude: 23.1115, longitude: 114.4152 }, // Huizhou/Guangdong pop=2900113
  梅州: { latitude: 24.2886, longitude: 116.1177 }, // Meizhou/Guangdong pop=992351
  汕尾: { latitude: 22.782, longitude: 115.3475 }, // Shanwei/Guangdong pop=491766
  河源: { latitude: 23.7333, longitude: 114.6833 }, // Heyuan/Guangdong pop=463907
  阳江: { latitude: 21.8556, longitude: 111.9627 }, // Yangjiang/Guangdong pop=1292987
  清远: { latitude: 23.7, longitude: 113.0333 }, // Qingyuan/Guangdong pop=1738424
  东莞: { latitude: 23.018, longitude: 113.7487 }, // Dongguan/Guangdong pop=9644871
  中山: { latitude: 22.5231, longitude: 113.3791 }, // Zhongshan/Guangdong pop=3841873
  潮州: { latitude: 23.654, longitude: 116.6226 }, // Chaozhou/Guangdong pop=1750945
  揭阳: { latitude: 23.5418, longitude: 116.3658 }, // Jieyang/Guangdong pop=1899394
  云浮: { latitude: 22.9279, longitude: 112.0381 }, // Yunfu/Guangdong pop=2612800
  海南州: { latitude: 36.284, longitude: 100.62 }, // 人工修正：人工标定：龙羊峡(36.13,100.90)与倒淌河(36.40,100.97)两锚点三角定位
  // 广西
  南宁: { latitude: 22.8167, longitude: 108.3167 }, // Nanning/Guangxi pop=5977185
  柳州: { latitude: 24.324, longitude: 109.407 }, // Liuzhou/Guangxi pop=1436599
  桂林: { latitude: 25.2802, longitude: 110.2964 }, // Guilin/Guangxi pop=1572300
  梧州: { latitude: 23.4805, longitude: 111.2885 }, // Wuzhou/Guangxi pop=761948
  北海: { latitude: 21.4835, longitude: 109.1155 }, // Beihai/Guangxi pop=525329
  防城港: { latitude: 21.7694, longitude: 108.3566 }, // Fangchenggang/Guangxi pop=276315
  钦州: { latitude: 21.9825, longitude: 108.6506 }, // Qinzhou/Guangxi pop=1296300
  贵港: { latitude: 23.116, longitude: 109.5947 }, // Guigang/Guangxi pop=1086327
  玉林: { latitude: 22.6305, longitude: 110.1469 }, // Yulin/Guangxi pop=1056743
  百色: { latitude: 23.8901, longitude: 106.6268 }, // Baise City/Guangxi pop=686078
  贺州: { latitude: 24.4036, longitude: 111.5667 }, // Hezhou/Guangxi pop=1005490
  河池: { latitude: 24.6928, longitude: 108.0838 }, // Hechi/Guangxi pop=330131
  来宾: { latitude: 23.7474, longitude: 109.2222 }, // Laibin/Guangxi pop=910282
  崇左: { latitude: 22.3816, longitude: 107.3683 }, // Chongzuo/Guangxi pop=384905
  // 海南
  海口: { latitude: 20.0342, longitude: 110.3465 }, // Haikou/Hainan pop=3001600
  三亚: { latitude: 18.2543, longitude: 109.5095 }, // Sanya/Hainan pop=1031396
  三沙: { latitude: 16.8391, longitude: 112.3406 }, // 人工修正：Sansha/永兴岛 pop=1443 PPLA2
  儋州: { latitude: 19.5213, longitude: 109.579 }, // Danzhou/Hainan pop=256652
  // 四川
  成都: { latitude: 30.6667, longitude: 104.0667 }, // Chengdu/Sichuan pop=20937757
  自贡: { latitude: 29.3416, longitude: 104.7769 }, // Zigong/Sichuan pop=1262064
  攀枝花: { latitude: 26.5851, longitude: 101.7128 }, // Panzhihua/Sichuan pop=787177
  泸州: { latitude: 28.8903, longitude: 105.4257 }, // Luzhou/Sichuan pop=998900
  德阳: { latitude: 31.1302, longitude: 104.382 }, // Deyang/Sichuan pop=735070
  绵阳: { latitude: 31.4678, longitude: 104.6817 }, // Mianyang/Sichuan pop=1550000
  广元: { latitude: 32.442, longitude: 105.823 }, // Guangyuan/Sichuan pop=516424
  遂宁: { latitude: 30.508, longitude: 105.5733 }, // Suining/Sichuan pop=656760
  内江: { latitude: 29.5835, longitude: 105.0622 }, // Neijiang/Sichuan pop=1251095
  乐山: { latitude: 29.5623, longitude: 103.7639 }, // Leshan/Sichuan pop=662814
  南充: { latitude: 30.7951, longitude: 106.0847 }, // Nanchong/Sichuan pop=1858875
  眉山: { latitude: 30.0439, longitude: 103.837 }, // Meishan/Sichuan pop=1107742
  宜宾: { latitude: 28.7593, longitude: 104.6399 }, // Yibin/Sichuan pop=836340
  广安: { latitude: 30.4741, longitude: 106.637 }, // Guang’an/Sichuan pop=858159
  达州: { latitude: 31.2106, longitude: 107.4631 }, // Dazhou/Sichuan pop=1589435
  雅安: { latitude: 29.9852, longitude: 102.999 }, // Ya'an/Sichuan pop=612056
  巴中: { latitude: 31.8694, longitude: 106.7443 }, // Bazhong/Sichuan pop=2712894
  资阳: { latitude: 30.1211, longitude: 104.6481 }, // Ziyang/Sichuan pop=905729
  阿坝: { latitude: 31.9006, longitude: 102.2209 }, // Barkam/Sichuan pop=58390
  甘孜: { latitude: 30.0022, longitude: 101.9569 }, // Kangding/Sichuan pop=100000
  凉山: { latitude: 27.8964, longitude: 102.2634 }, // Xichang/Sichuan pop=481796
  // 贵州
  贵阳: { latitude: 26.5833, longitude: 106.7167 }, // Guiyang/Guizhou pop=4506134
  六盘水: { latitude: 26.5944, longitude: 104.8333 }, // Liupanshui/Guizhou pop=1320825
  遵义: { latitude: 27.6867, longitude: 106.9072 }, // Zunyi/Guizhou pop=2037775
  安顺: { latitude: 26.25, longitude: 105.9333 }, // Anshun/Guizhou pop=765313
  毕节: { latitude: 27.3019, longitude: 105.2863 }, // Bijie/Guizhou pop=1137383
  铜仁: { latitude: 27.7172, longitude: 109.1853 }, // Tongren/Guizhou pop=90593
  黔西南: { latitude: 25.0962, longitude: 104.9064 }, // Xingyi/Guizhou pop=322890
  黔东南: { latitude: 26.5858, longitude: 107.9797 }, // Kaili/Guizhou pop=275745
  黔南: { latitude: 26.2667, longitude: 107.5167 }, // Duyun/Guizhou pop=198516
  // 云南
  昆明: { latitude: 25.0389, longitude: 102.7183 }, // Kunming/Yunnan pop=5950578
  曲靖: { latitude: 25.4833, longitude: 103.7833 }, // Qujing/Yunnan pop=1408500
  玉溪: { latitude: 24.355, longitude: 102.5422 }, // Yuxi/Yunnan pop=103829
  保山: { latitude: 25.1163, longitude: 99.1637 }, // Baoshan/Yunnan pop=935618
  昭通: { latitude: 27.3167, longitude: 103.7167 }, // Zhaotong/Yunnan pop=787845
  丽江: { latitude: 26.8688, longitude: 100.2207 }, // Lijiang/Yunnan pop=211151
  普洱: { latitude: 22.7886, longitude: 100.9748 }, // Pu'er/Yunnan pop=296565
  临沧: { latitude: 23.8797, longitude: 100.0945 }, // Lincang/Yunnan pop=323708
  楚雄: { latitude: 25.0364, longitude: 101.5456 }, // Chuxiong/Yunnan pop=555081
  红河: { latitude: 23.3678, longitude: 103.3821 }, // Mengzi/Yunnan pop=595100
  文山: { latitude: 23.3631, longitude: 104.2505 }, // Wenshan City/Yunnan pop=450000
  西双版纳: { latitude: 22.0148, longitude: 100.7984 }, // Jinghong/Yunnan pop=205523
  大理: { latitude: 25.5847, longitude: 100.2123 }, // Dali/Yunnan pop=235305
  德宏: { latitude: 24.4533, longitude: 98.5704 }, // Mang City/Yunnan pop=46353
  怒江: { latitude: 25.8232, longitude: 98.8585 }, // Lushui/Yunnan pop=197000
  迪庆: { latitude: 27.8251, longitude: 99.7078 }, // Shangri-La/Yunnan pop=186400
  // 西藏
  拉萨: { latitude: 29.65, longitude: 91.1 }, // Lhasa/Tibet pop=867900
  日喀则: { latitude: 29.25, longitude: 88.8833 }, // 人工修正：Xigazê/Tibet pop=80000 PPLA2
  昌都: { latitude: 31.1304, longitude: 97.1798 }, // Chamdo/Tibet pop=86280
  林芝: { latitude: 29.6488, longitude: 94.3551 }, // Nyingchi/Tibet pop=200000
  那曲: { latitude: 31.4768, longitude: 92.0573 }, // Nagqu/Tibet pop=30000
  阿里: { latitude: 32.5012, longitude: 80.0976 }, // Shiquanhe/Tibet pop=24910
  // 陕西
  西安: { latitude: 34.2583, longitude: 108.9286 }, // Xi'an/Shaanxi pop=12952907
  铜川: { latitude: 34.8988, longitude: 108.9506 }, // Tongchuan/Shaanxi pop=417740
  宝鸡: { latitude: 34.3678, longitude: 107.237 }, // Baoji/Shaanxi pop=1437802
  咸阳: { latitude: 34.3378, longitude: 108.7026 }, // Xianyang/Shaanxi pop=1034081
  渭南: { latitude: 34.5035, longitude: 109.5089 }, // Weinan/Shaanxi pop=1199290
  延安: { latitude: 36.5989, longitude: 109.4917 }, // Yan’an/Shaanxi pop=475234
  汉中: { latitude: 33.0751, longitude: 107.0221 }, // Hanzhong/Shaanxi pop=1006557
  榆林: { latitude: 38.2918, longitude: 109.7375 }, // Yulin/Shaanxi pop=90870
  安康: { latitude: 32.68, longitude: 109.0172 }, // Ankang/Shaanxi pop=870126
  商洛: { latitude: 33.8667, longitude: 109.9306 }, // Shangluo/Shaanxi pop=531696
  // 甘肃
  兰州: { latitude: 36.057, longitude: 103.8399 }, // Lanzhou/Gansu pop=4359446
  嘉峪关: { latitude: 39.8112, longitude: 98.2862 }, // Jiayuguan/Gansu pop=231853
  金昌: { latitude: 38.5006, longitude: 102.1938 }, // Jinchang/Gansu pop=228561
  白银: { latitude: 36.547, longitude: 104.1702 }, // Baiyin/Gansu pop=294400
  天水: { latitude: 34.5795, longitude: 105.7424 }, // Tianshui/Gansu pop=1212791
  武威: { latitude: 37.9267, longitude: 102.632 }, // Wuwei/Gansu pop=1010295
  张掖: { latitude: 38.9342, longitude: 100.4517 }, // Zhangye/Gansu pop=507433
  平凉: { latitude: 35.5392, longitude: 106.6861 }, // Pingliang/Gansu pop=504848
  酒泉: { latitude: 39.7432, longitude: 98.5174 }, // Jiuquan/Gansu pop=428346
  庆阳: { latitude: 35.7098, longitude: 107.6445 }, // Qingyang/Gansu pop=2125400
  定西: { latitude: 35.5709, longitude: 104.623 }, // Dingxi/Gansu pop=420614
  陇南: { latitude: 33.3979, longitude: 104.917 }, // Longnan/Gansu pop=85826
  临夏: { latitude: 35.6003, longitude: 103.2064 }, // Linxia/Gansu pop=274466
  甘南: { latitude: 34.9856, longitude: 102.9094 }, // Hezuo/Gansu pop=59148
  // 青海
  西宁: { latitude: 36.6255, longitude: 101.7574 }, // Xining/Qinghai pop=2467965
  海东: { latitude: 36.48, longitude: 102.4164 }, // Haidong/Qinghai pop=260184
  黄南: { latitude: 35.5148, longitude: 102.016 }, // Tongren/Qinghai pop=103700
  果洛: { latitude: 34.4744, longitude: 100.245 }, // 人工修正：Golog(玛沁)/Qinghai pop=59900 PPLA2
  玉树: { latitude: 33.0012, longitude: 97.0089 }, // Yushu/Qinghai pop=141308
  海西: { latitude: 37.376, longitude: 97.3746 }, // 人工修正：Delingha(德令哈)/Qinghai PPLA3
  // 宁夏
  银川: { latitude: 38.4681, longitude: 106.2731 }, // Yinchuan/Ningxia pop=2859074
  石嘴山: { latitude: 38.9808, longitude: 106.3892 }, // Shizuishan/Ningxia pop=739400
  吴忠: { latitude: 37.9867, longitude: 106.201 }, // Wuzhong/Ningxia pop=7202654
  固原: { latitude: 36.0067, longitude: 106.2808 }, // Guyuan/Ningxia pop=411854
  中卫: { latitude: 37.5113, longitude: 105.1907 }, // Zhongwei/Ningxia pop=1174600
  // 新疆
  乌鲁木齐: { latitude: 43.801, longitude: 87.6005 }, // Ürümqi/Xinjiang pop=4054000
  克拉玛依: { latitude: 45.5847, longitude: 84.8872 }, // Karamay/Xinjiang pop=261445
  吐鲁番: { latitude: 42.9477, longitude: 89.1789 }, // Turpan/Xinjiang pop=273385
  哈密: { latitude: 42.8339, longitude: 93.506 }, // Hami/Xinjiang pop=246373
  昌吉: { latitude: 44.0078, longitude: 87.3046 }, // Changji/Xinjiang pop=198776
  博尔塔拉: { latitude: 44.8933, longitude: 82.0699 }, // Bole/Xinjiang pop=235585
  巴音郭楞: { latitude: 41.7606, longitude: 86.1523 }, // Korla/Xinjiang pop=549324
  阿克苏: { latitude: 41.1842, longitude: 80.2792 }, // Aksu/Xinjiang pop=535657
  克孜勒苏: { latitude: 39.7084, longitude: 76.1797 }, // 人工修正：Artux(阿图什)/Xinjiang pop=285000 PPLA2
  喀什: { latitude: 39.4672, longitude: 75.9868 }, // Kashgar/Xinjiang pop=506640
  和田: { latitude: 37.1093, longitude: 79.9343 }, // Hotan/Xinjiang pop=408894
  伊犁: { latitude: 43.9151, longitude: 81.3215 }, // Yining/Xinjiang pop=269158
  塔城: { latitude: 46.7454, longitude: 82.9585 }, // Tacheng/Xinjiang pop=161037
  阿勒泰: { latitude: 47.8505, longitude: 88.1329 }, // Altay/Xinjiang pop=190064
  // 香港特别行政区
  香港: { latitude: 22.3193, longitude: 114.1694 }, // Hong Kong
  九龙: { latitude: 22.3228, longitude: 114.187 }, // Kowloon
  新界: { latitude: 22.3823, longitude: 114.1891 }, // Sha Tin（新界代表点）
  // 澳门特别行政区
  澳门: { latitude: 22.1987, longitude: 113.5439 }, // Macau
  // 台湾
  台北: { latitude: 25.033, longitude: 121.5654 }, // Taipei
  新北: { latitude: 25.0119, longitude: 121.4658 }, // Banqiao/New Taipei
  桃园: { latitude: 24.9936, longitude: 121.301 }, // Taoyuan
  台中: { latitude: 24.1477, longitude: 120.6736 }, // Taichung
  台南: { latitude: 22.9999, longitude: 120.2269 }, // Tainan
  高雄: { latitude: 22.6273, longitude: 120.3014 }, // Kaohsiung
  基隆: { latitude: 25.1276, longitude: 121.7392 }, // Keelung
  新竹: { latitude: 24.8138, longitude: 120.9675 }, // Hsinchu
  嘉义: { latitude: 23.48, longitude: 120.4491 }, // Chiayi
  宜兰: { latitude: 24.757, longitude: 121.753 }, // Yilan
  花莲: { latitude: 23.9769, longitude: 121.6038 }, // Hualien
  台东: { latitude: 22.7583, longitude: 121.1444 }, // Taitung
  澎湖: { latitude: 23.5712, longitude: 119.5793 }, // Magong/Penghu
  金门: { latitude: 24.4367, longitude: 118.318 }, // Jincheng/Kinmen
  连江: { latitude: 26.1508, longitude: 119.9519 }, // Nangan/Lienchiang
}

/** 城市别名 → 规范名。治所（自治州/盟驻地）与常见简称。 */
export const CITY_ALIASES = {
  '海拉尔': '呼伦贝尔',
  '乌兰浩特': '兴安盟',
  '锡林浩特': '锡林郭勒盟',
  '巴彦浩特': '阿拉善盟',
  '阿拉善左旗': '阿拉善盟',
  '延吉': '延边',
  '加格达奇': '大兴安岭',
  '吉首': '湘西',
  '马尔康': '阿坝',
  '康定': '甘孜',
  '西昌': '凉山',
  '兴义': '黔西南',
  '凯里': '黔东南',
  '都匀': '黔南',
  '蒙自': '红河',
  '景洪': '西双版纳',
  '下关': '大理',
  '芒市': '德宏',
  '泸水': '怒江',
  '六库': '怒江',
  '香格里拉': '迪庆',
  '中甸': '迪庆',
  '泽当': '山南',
  '乃东': '山南',
  '色尼': '那曲',
  '桑珠孜': '日喀则',
  '巴宜': '林芝',
  '八一': '林芝',
  '噶尔': '阿里',
  '狮泉河': '阿里',
  '合作': '甘南',
  '海晏': '海北',
  '西海镇': '海北',
  '同仁': '黄南',
  '共和': '海南州',
  '恰卜恰': '海南州',
  '玛沁': '果洛',
  '大武': '果洛',
  '结古': '玉树',
  '德令哈': '海西',
  '博乐': '博尔塔拉',
  '库尔勒': '巴音郭楞',
  '阿图什': '克孜勒苏',
  '伊宁': '伊犁',
  '永兴岛': '三沙',
  '呼市': '呼和浩特',
  '乌市': '乌鲁木齐',
  '海南': '海口',
  '香港特别行政区': '香港',
  '澳门特别行政区': '澳门',
  '台湾省': '台北',
  '台湾': '台北',
}

/** 省级行政区名，用于剥离「湖南益阳」这类前缀。 */
const PROVINCES = [
  '黑龙江', '内蒙古', '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东',
  '广西', '海南', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
  '香港', '澳门', '台湾'
]

/** 行政后缀，按长度降序剥离，避免「自治州」被先剥成「自治」。 */
const SUFFIXES = ['特别行政区', '自治州', '地区', '盟', '市']

/**
 * 直接查表：主表 → 别名表。
 * @returns {string} 命中的规范名，没命中返回空串。
 */
function lookup(name) {
  if (Object.prototype.hasOwnProperty.call(CITY_COORDS, name)) return name
  if (Object.prototype.hasOwnProperty.call(CITY_ALIASES, name)) return CITY_ALIASES[name]
  return ''
}

/**
 * 处理「红河哈尼族彝族自治州」这类全称：剥掉后缀后，
 * 从长到短试前缀，第一个命中主表的长度就是规范名。
 */
function matchByShrinkingPrefix(stem) {
  for (let len = Math.min(stem.length, 6); len >= 2; len--) {
    const hit = lookup(stem.slice(0, len))
    if (hit !== '') return hit
  }
  return ''
}

/**
 * 把用户填的城市名归一化成主表里的规范名。
 *
 * 依次尝试：原样 → 剥行政后缀（自治州全称走后缀内前缀递减）→ 剥省份前缀后重来一遍。
 * 每步都先查主表再查别名表，命中即返回，不做任何猜测。
 *
 * @param {unknown} input
 * @returns {string} 规范名；解析不出返回空串。
 */
export function normalizeCityName(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return ''

  const direct = lookup(raw)
  if (direct !== '') return direct

  for (const suffix of SUFFIXES) {
    if (!raw.endsWith(suffix) || raw.length <= suffix.length) continue
    const stem = raw.slice(0, -suffix.length)
    const hit = lookup(stem)
    if (hit !== '') return hit
    const shrunk = matchByShrinkingPrefix(stem)
    if (shrunk !== '') return shrunk
  }

  // 裸输入不做前缀递减，否则「天津饭」会命中天津、「上海滩」会命中上海。
  // 前缀递减只在剥掉行政后缀之后用，专门处理「红河哈尼族彝族自治州」这类全称。

  // 「湖南益阳」「广西玉林」这类带省份前缀的写法
  for (const prov of PROVINCES) {
    if (!raw.startsWith(prov) || raw.length <= prov.length) continue
    const rest = raw.slice(prov.length)
    const hit = lookup(rest)
    if (hit !== '') return hit
    for (const suffix of SUFFIXES) {
      if (!rest.endsWith(suffix) || rest.length <= suffix.length) continue
      const inner = rest.slice(0, -suffix.length)
      const h2 = lookup(inner)
      if (h2 !== '') return h2
      const h3 = matchByShrinkingPrefix(inner)
      if (h3 !== '') return h3
    }
    const h4 = matchByShrinkingPrefix(rest)
    if (h4 !== '') return h4
  }

  return ''
}

/**
 * 解析城市名到坐标。
 *
 * @param {unknown} input 用户填写的城市名
 * @returns {{ city: string, latitude: number, longitude: number } | null}
 *   解析成功返回规范名与坐标；查不到返回 null，由调用方决定怎么办。
 */
export function resolveCity(input) {
  const name = normalizeCityName(input)
  if (name === '') return null
  const coords = CITY_COORDS[name]
  if (!coords) return null
  return { city: name, latitude: coords.latitude, longitude: coords.longitude }
}

/** 表里一共收录了多少个，供设置页/诊断显示。 */
export function cityTableSize() {
  return Object.keys(CITY_COORDS).length
}
