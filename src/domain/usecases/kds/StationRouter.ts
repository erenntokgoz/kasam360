import { Order, OrderItem, StationItemMap, StationType } from './types';

export const ALL_STATIONS: readonly StationType[] = [
  'Grill',
  'Fryer',
  'Pizza',
  'Bar',
  'Prep',
] as const;

export interface StationRoutingRule {
  station: StationType;
  keywords: string[];
}

export class StationRouter {
  private readonly routingRules: StationRoutingRule[] = [
    {
      station: 'Grill',
      keywords: [
        'burger',
        'steak',
        'grill',
        'patty',
        'ribeye',
        'sirloin',
        'skewer',
        'kebab',
        'meatball',
        'bbq',
      ],
    },
    {
      station: 'Fryer',
      keywords: [
        'fry',
        'fries',
        'fryer',
        'wing',
        'wings',
        'nugget',
        'onion ring',
        'calamari',
        'tempura',
        'crispy',
        'tenders',
      ],
    },
    {
      station: 'Pizza',
      keywords: ['pizza', 'calzone', 'flatbread', 'focaccia', 'margherita', 'pepperoni', 'dough'],
    },
    {
      station: 'Bar',
      keywords: [
        'bar',
        'beverage',
        'drink',
        'cocktail',
        'beer',
        'wine',
        'soda',
        'juice',
        'coffee',
        'tea',
        'water',
      ],
    },
    {
      station: 'Prep',
      keywords: [
        'prep',
        'salad',
        'cold',
        'dessert',
        'soup',
        'appetizer',
        'sauce',
        'sandwich',
        'wrap',
        'platter',
      ],
    },
  ];

  /**
   * Determines destination station for a given OrderItem based on explicit assignment,
   * productType, category, or item name.
   */
  public resolveStation(item: OrderItem): StationType {
    if (item.station && ALL_STATIONS.includes(item.station)) {
      return item.station;
    }

    const descriptors = [item.productType, item.category, item.name]
      .filter((val): val is string => Boolean(val && typeof val === 'string'))
      .map((val) => val.trim().toLowerCase());

    for (const rule of this.routingRules) {
      for (const descriptor of descriptors) {
        if (rule.keywords.some((kw) => descriptor.includes(kw))) {
          return rule.station;
        }
      }
    }

    return 'Prep';
  }

  /**
   * Processes an incoming Order and partitions its items strictly grouped by destination station.
   */
  public routeOrder(order: Order): StationItemMap {
    const partitioned: StationItemMap = {
      Grill: [],
      Fryer: [],
      Pizza: [],
      Bar: [],
      Prep: [],
    };

    if (!order || !Array.isArray(order.items)) {
      return partitioned;
    }

    for (const item of order.items) {
      const destinationStation = this.resolveStation(item);
      partitioned[destinationStation].push({
        ...item,
        station: destinationStation,
      });
    }

    return partitioned;
  }

  /**
   * Static utility to route an order without requiring instance creation.
   */
  public static route(order: Order): StationItemMap {
    const router = new StationRouter();
    return router.routeOrder(order);
  }
}
